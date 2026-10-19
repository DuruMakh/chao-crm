const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function client(fetch) {
    const storage=new Map();let uuid=0;
    const context=vm.createContext({window:{CRM_CONFIG:{apiUrl:'https://example.test/exec'}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},crypto:{randomUUID:()=>`request-${++uuid}`},AbortSignal,fetch});
    vm.runInContext(fs.readFileSync(require.resolve('../crm-api.js'),'utf8'),context);
    return context.window.CrmApi;
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
