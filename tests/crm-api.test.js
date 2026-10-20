const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

let uuid=0;
function client(fetch, storage=new Map(), locks) {
    const context=vm.createContext({window:{CRM_CONFIG:{apiUrl:'https://example.test/exec'},navigator:{locks}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},crypto:{randomUUID:()=>`request-${++uuid}`},AbortSignal,fetch});
    vm.runInContext(fs.readFileSync(require.resolve('../crm-api.js'),'utf8'),context);
    return context.window.CrmApi;
}
const response = value=>({ok:true,json:async()=>({success:true,version:2,...value})});
function deferred() { let resolve; const promise=new Promise(done=>resolve=done); return {promise,resolve}; }
function sharedLocks() {
    let queue=Promise.resolve();
    return {request(name,change){const next=queue.then(change);queue=next.catch(()=>{});return next;}};
}
test('Failed save does not change confirmed cache and a retry reuses its save ID',async()=>{
    const requests=[];
    const api=client(async(url,options)=>{
        requests.push(JSON.parse(options.body));
        if(requests.length===1)throw new TypeError('Network disconnected');
        return {ok:true,json:async()=>({success:true,version:2,order:{id:'a',revision:1,name:'Saved'}})};
    });
    const draft={id:'a',revision:0,name:'Saved'};
    await assert.rejects(()=>api.save(draft));
    assert.equal(api.cachedOrders().length,0);
    const result=await api.save(draft);
    assert.equal(result.revision,1);assert.equal(api.cachedOrders().length,1);
    assert.equal(requests[0].requestId,requests[1].requestId);
    assert.equal(requests[0].version,2);
});
test('Server validation errors and wrong API versions never become confirmed cache',async()=>{
    const api=client(async()=>({ok:true,json:async()=>({success:false,version:2,error:{code:'CONFLICT',message:'Stale editor'}})}));
    await assert.rejects(()=>api.save({id:'a'}),{code:'CONFLICT'});
    assert.equal(api.cachedOrders().length,0);
    const oldApi=client(async()=>({ok:true,json:async()=>({success:true,version:1,orders:[{id:'old'}]})}));
    await assert.rejects(()=>oldApi.list());assert.equal(oldApi.cachedOrders().length,0);
});

test('A failed deletion keeps the confirmed cache; a successful retry removes only that order',async()=>{
    let attempts=0; const requests=[];
    const api=client(async(url,options)=>{
        if(!options.method)return {ok:true,json:async()=>({success:true,version:2,orders:[{id:'remove',revision:2},{id:'keep',revision:1}]})};
        requests.push(JSON.parse(options.body));
        if(++attempts===1)throw new TypeError('Response lost');
        return {ok:true,json:async()=>({success:true,version:2,deletedId:'remove'})};
    });
    await api.list();
    await assert.rejects(()=>api.remove({id:'remove',revision:2}));
    assert.equal(api.cachedOrders().length,2);
    assert.equal(await api.remove({id:'remove',revision:2}),'remove');
    assert.deepEqual(Array.from(api.cachedOrders(),o=>o.id),['keep']);
    assert.deepEqual(requests[0],{action:'delete',version:2,orderId:'remove',revision:2});
    assert.deepEqual(requests[0],requests[1]);
});

test('A delete response for the wrong order is not treated as confirmation',async()=>{
    const api=client(async(url,options)=>({ok:true,json:async()=>options.method?{success:true,version:2,deletedId:'other'}:{success:true,version:2,orders:[{id:'keep',revision:1}]}}));
    await api.list(); await assert.rejects(()=>api.remove({id:'keep',revision:1}));
    assert.equal(api.cachedOrders().length,1);
});

test('Old array caches migrate without changing the rollback format or inventing freshness',async()=>{
    const legacy=JSON.stringify([{id:'old',revision:1}]),storage=new Map([['chao_crm_orders_v1',legacy]]);
    const api=client(async()=>response({orders:[{id:'fresh',revision:2}]}),storage);
    assert.equal(api.cachedState().available,true);assert.equal(api.cachedState().refreshedAt,null);
    assert.equal(api.cachedOrders()[0].id,'old');
    await api.list();
    assert.equal(storage.get('chao_crm_orders_v1'),legacy);
    assert.equal(JSON.parse(storage.get('chao_crm_orders_v2')).orders[0].id,'fresh');
    assert.ok(!Number.isNaN(Date.parse(api.cachedState().refreshedAt)));
});

test('Individual saves and deletions preserve the last full-list confirmation time',async()=>{
    const api=client(async(url,options)=>{
        if(!options.method)return response({orders:[{id:'a',revision:1},{id:'b',revision:1}]});
        const data=JSON.parse(options.body);
        return response(data.action==='delete'?{deletedId:'a'}:{order:{...data.order,revision:2}});
    });
    await api.list();const refreshedAt=api.cachedState().refreshedAt;
    await api.save({id:'a',revision:1});
    assert.equal(api.cachedState().refreshedAt,refreshedAt);
    await api.remove({id:'a',revision:2});
    assert.equal(api.cachedState().refreshedAt,refreshedAt);
    assert.deepEqual(Array.from(api.cachedOrders(),o=>o.id),['b']);
});

test('A successful empty list is cached and list always checks the network again',async()=>{
    let requests=0;
    const api=client(async()=>{requests++;return response({orders:[]});});
    assert.equal(api.cachedState().available,false);
    await api.list();assert.equal(api.cachedState().available,true);
    await api.list();assert.equal(requests,2);
});

test('A late list cannot undo a save or deletion in its own tab or another tab',async()=>{
    for(const separateTab of [false,true])for(const action of ['save','delete']){
        const storage=new Map(),locks=sharedLocks(),oldRead=deferred();
        let server=[{id:'a',revision:1},{id:'b',revision:1}],reads=0;
        const fetch=async(url,options)=>{
            if(!options.method){if(++reads===1)return oldRead.promise;return response({orders:structuredClone(server)});}
            const data=JSON.parse(options.body);
            if(data.action==='delete'){server=server.filter(o=>o.id!=='a');return response({deletedId:'a'});}
            server=[{id:'a',revision:2},server[1]];return response({order:server[0]});
        };
        const reading=client(fetch,storage,locks),writing=separateTab?client(fetch,storage,locks):reading;
        const pending=reading.list();
        if(action==='save')await writing.save({id:'a',revision:1});else await writing.remove({id:'a',revision:1});
        oldRead.resolve(response({orders:[{id:'a',revision:1},{id:'b',revision:1}]}));
        const result=await pending;
        assert.equal(reads,2);
        assert.deepEqual(JSON.parse(JSON.stringify(result)),server);
        assert.deepEqual(JSON.parse(JSON.stringify(reading.cachedOrders())),server);
    }
});

test('An older list response cannot replace a newer completed list',async()=>{
    const storage=new Map(),locks=sharedLocks(),older=deferred();let reads=0;
    const fetch=async()=>++reads===1?older.promise:response({orders:[{id:'a',revision:2}]});
    const first=client(fetch,storage,locks),second=client(fetch,storage,locks);
    const pending=first.list();await second.list();
    older.resolve(response({orders:[{id:'a',revision:1}]}));
    assert.equal((await pending)[0].revision,2);
    assert.equal(first.cachedOrders()[0].revision,2);assert.equal(reads,3);
});

test('A write from an older open page invalidates an in-flight new-page refresh',async()=>{
    const storage=new Map(),older=deferred();let reads=0;
    const api=client(async()=>++reads===2?older.promise:response({orders:[{id:'a',revision:reads===1?1:2}]}),storage);
    await api.list();const pending=api.list();
    storage.set('chao_crm_orders_v1',JSON.stringify([{id:'a',revision:2}]));
    older.resolve(response({orders:[{id:'a',revision:1}]}));
    assert.equal((await pending)[0].revision,2);assert.equal(reads,3);
    assert.equal(JSON.parse(storage.get('chao_crm_orders_v1'))[0].revision,2);
});

test('Repeated concurrent changes stop the refresh without returning stale data as fresh',async()=>{
    let api,reads=0;
    api=client(async(url,options)=>{
        if(options.method)return response({order:{id:'a',revision:reads}});
        reads++;await api.save({id:'a',revision:reads-1});
        return response({orders:[]});
    });
    await assert.rejects(()=>api.list(),{code:'REFRESH_SUPERSEDED'});
    assert.equal(reads,2);assert.equal(api.cachedOrders()[0].revision,2);
    assert.equal(api.cachedState().refreshedAt,null);
});

test('Confirmed state remains available within the page when browser cache writes fail',async()=>{
    const storage={get(){return null;},set(){throw new Error('Storage full');}};
    const api=client(async(url,options)=>response(options.method?{order:{id:'b',revision:1}}:{orders:[{id:'a',revision:1}]}),storage);
    await api.list();await api.save({id:'b',revision:0});
    assert.deepEqual(Array.from(api.cachedOrders(),o=>o.id),['a','b']);
    assert.ok(api.cachedState().refreshedAt);
});

test('A delayed save response cannot restore a confirmed deletion or report current success',async()=>{
    for(const initialRevision of [0,1]){
        const storage=new Map(),locks=sharedLocks(),savedResponse=deferred();
        let server=initialRevision?[{id:'a',revision:initialRevision}]:[],posts=0;
        const fetch=async(url,options)=>{
            if(!options.method)return response({orders:structuredClone(server)});
            posts++;const data=JSON.parse(options.body);
            if(data.action==='delete'){server=[];return response({deletedId:'a'});}
            server=[{id:'a',revision:initialRevision+1,lastRequestId:data.requestId}];
            return savedResponse.promise;
        };
        const first=client(fetch,storage,locks),second=client(fetch,storage,locks);
        const pending=first.save({id:'a',revision:initialRevision});
        const saved=(await second.list())[0];
        await second.remove(saved);await second.list();
        savedResponse.resolve(response({order:saved}));
        await assert.rejects(()=>pending,{code:'ORDER_DELETED'});
        assert.equal(first.cachedOrders().length,0);assert.equal(second.cachedOrders().length,0);
        await assert.rejects(()=>first.save({id:'a',revision:initialRevision}),{code:'ORDER_DELETED'});
        assert.equal(posts,2);
    }
});

test('A delayed save response cannot replace a newer revision or return it as this editor’s success',async()=>{
    const storage=new Map(),locks=sharedLocks(),savedResponse=deferred();
    let server=[{id:'a',revision:1}],posts=0;
    const fetch=async(url,options)=>{
        if(!options.method)return response({orders:structuredClone(server)});
        const data=JSON.parse(options.body);
        server=[{...data.order,revision:data.order.revision+1,lastRequestId:data.requestId}];
        return ++posts===1?savedResponse.promise:response({order:server[0]});
    };
    const first=client(fetch,storage,locks),second=client(fetch,storage,locks);
    const pending=first.save({id:'a',revision:1,notes:'First edit'});
    const saved=(await second.list())[0];
    await second.save({...saved,notes:'Newer edit'});
    savedResponse.resolve(response({order:saved}));
    await assert.rejects(()=>pending,{code:'CONFLICT'});
    assert.equal(first.cachedOrders()[0].revision,3);assert.equal(first.cachedOrders()[0].notes,'Newer edit');
});

test('A lost-response retry remains idempotent when a refresh has already found its confirmed save',async()=>{
    let saved,attempts=0;
    const api=client(async(url,options)=>{
        if(!options.method)return response({orders:[saved]});
        const data=JSON.parse(options.body);
        if(++attempts===1){saved={...data.order,revision:2,lastRequestId:data.requestId};throw new Error('Response lost');}
        assert.equal(data.requestId,saved.lastRequestId);return response({order:saved});
    });
    const draft={id:'a',revision:1};
    await assert.rejects(()=>api.save(draft));await api.list();
    assert.equal((await api.save(draft)).revision,2);
});

test('A delayed save reconciles a confirmed deletion made by an older open page',async()=>{
    const storage=new Map(),savedResponse=deferred();let server=[{id:'a',revision:1}],reads=0;
    const api=client(async(url,options)=>{
        if(!options.method){reads++;return response({orders:structuredClone(server)});}
        server=[{id:'a',revision:2}];return savedResponse.promise;
    },storage);
    await api.list();const pending=api.save({id:'a',revision:1});
    server=[];storage.set('chao_crm_orders_v1','[]');
    savedResponse.resolve(response({order:{id:'a',revision:2}}));
    await assert.rejects(()=>pending,{code:'ORDER_DELETED'});
    assert.equal(api.cachedOrders().length,0);assert.equal(reads,2);
});
