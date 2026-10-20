const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const CrmModel=require('../crm-model.js');

const response=value=>({ok:true,json:async()=>({success:true,version:2,...value})});
function deferred(){let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};}
function order(change={}){
    return {...CrmModel.fromLegacy({id:'loading-test',name:'Test event',total:100,date:'2026-10-20T10:00:00Z',quantitiesByName:{}}),
        revision:1,pricing:'snapshot',clientName:'Saved client',paid:20,items:[{name:'Lunch',qty:2,price:50}],...change};
}
function page({cached,hash='',draft,fetch}={}){
    const elements=new Map(),storage=new Map(),drafts=new Map(),cleared=[],scrolls=[],requests=[];
    if(cached)storage.set('chao_crm_orders_v1',JSON.stringify(cached));
    if(draft)drafts.set(draft.id,structuredClone(draft));
    const get=id=>{
        if(!elements.has(id)){
            const classes=new Set();
            const classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),
                toggle(c,on){if(on)classes.add(c);else classes.delete(c);}};
            elements.set(id,{id,value:id==='stageFilter'?'all':'',textContent:'',innerHTML:'',hidden:id==='detailView'||id==='deleteConfirm',
                disabled:false,checked:false,style:{},classList,handlers:{},
                addEventListener(name,fn){this.handlers[name]=fn;},insertAdjacentHTML(){},closest:()=>({classList}),
                focus(){document.activeElement=this;}});
        }
        return elements.get(id);
    };
    const document={body:{},getElementById:get,createElement:()=>({textContent:'',get innerHTML(){return String(this.textContent).replaceAll('&','&amp;').replaceAll('<','&lt;');}})};
    document.activeElement=document.body;
    const location={hash,replace(url){this.replaced=url;}},window={CRM_CONFIG:{apiUrl:'https://example.test/exec'},
        scrollX:12,scrollY:345,addEventListener(){},scrollTo(left,top){scrolls.push([left,top]);}};
    let uuid=0;
    const context=vm.createContext({document,location,window,structuredClone,URLSearchParams,CrmModel,AbortSignal,
        crypto:{randomUUID:()=>`loading-request-${++uuid}`},CRM_CONFIG:{spreadsheetUrl:''},
        localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
        history:{replaceState(a,b,url){location.hash=url;}},confirm:()=>true,
        fetch:async(url,options)=>{requests.push(options);return fetch?fetch(url,options):response({orders:[]});},
        CrmDraft:{load:id=>drafts.get(id),clear(id){cleared.push(id);drafts.delete(id);},save(value){drafts.set(value.id,structuredClone(value));}}});
    vm.runInContext(fs.readFileSync(require.resolve('../crm-api.js'),'utf8'),context);
    context.CrmApi=window.CrmApi;
    const loading=vm.runInContext(fs.readFileSync(require.resolve('../crm.js'),'utf8'),context);
    return {get,document,location,cleared,scrolls,requests,loading,api:window.CrmApi,
        run:code=>vm.runInContext(code,context),
        edit(id,value){get(id).value=value;get('orderForm').handlers.input({target:{name:id,value}});},
        submit:()=>get('orderForm').handlers.submit({preventDefault(){}})};
}

test('Cached rows appear synchronously while their independent fresh request is pending',async()=>{
    const read=deferred(),ui=page({cached:[order()],fetch:()=>read.promise});
    assert.match(ui.get('orderRows').innerHTML,/Test event/);
    assert.match(ui.get('notice').textContent,/მოწმდება განახლებები/);
    assert.equal(ui.get('refreshBtn').disabled,true);
    read.resolve(response({orders:[order({name:'Fresh event',revision:2})]}));await ui.loading;
    assert.match(ui.get('orderRows').innerHTML,/Fresh event/);
    assert.equal(ui.get('refreshBtn').disabled,false);assert.equal(ui.get('notice').hidden,true);
});

test('A first visit shows loading rather than an authoritative empty list',async()=>{
    const read=deferred(),ui=page({fetch:()=>read.promise});
    assert.match(ui.get('emptyTitle').textContent,/იტვირთება/);
    read.resolve(response({orders:[]}));await ui.loading;
    assert.match(ui.get('emptyTitle').textContent,/პირველი შეკვეთა/);
    assert.equal(ui.api.cachedState().available,true);
});

test('A clean cached detail refresh preserves keyboard focus and scroll position',async()=>{
    const read=deferred(),ui=page({cached:[order()],hash:'#order=loading-test',fetch:()=>read.promise});
    assert.equal(ui.get('clientName').value,'Saved client');ui.get('notes').focus();
    read.resolve(response({orders:[order({clientName:'Fresh client',revision:2})]}));await ui.loading;
    assert.equal(ui.get('clientName').value,'Fresh client');
    assert.equal(ui.document.activeElement,ui.get('notes'));
    assert.deepEqual(ui.scrolls.at(-1),[12,345]);
    assert.equal(ui.run('activeOrder.revision'),2);
});

test('A refresh preserves unfinished fields and their original editing revision',async()=>{
    const read=deferred(),ui=page({cached:[order()],hash:'#order=loading-test',fetch:()=>read.promise});
    ui.edit('clientName','Unfinished client');ui.edit('paid','75');
    read.resolve(response({orders:[order({clientName:'Other editor',revision:2})]}));await ui.loading;
    assert.equal(ui.get('clientName').value,'Unfinished client');assert.equal(ui.get('paid').value,'75');
    assert.equal(ui.run('activeOrder.revision'),1);assert.equal(ui.run('dirty'),true);
    assert.match(ui.get('notice').textContent,/სხვა ფანჯარაში/);
});

test('Cached detail and local draft remain usable when confirmation fails',async()=>{
    for(const isDraft of [false,true]){
        const read=deferred(),initial=order({revision:isDraft?0:1});
        const ui=page({cached:isDraft?undefined:[initial],draft:isDraft?initial:undefined,
            hash:`#${isDraft?'draft':'order'}=loading-test`,fetch:()=>read.promise});
        assert.equal(ui.get('detailView').hidden,false);
        ui.edit('notes','Keep these details');
        read.reject(new Error('Connection timed out'));await ui.loading;
        assert.equal(ui.get('detailView').hidden,false);assert.equal(ui.get('notes').value,'Keep these details');
        assert.equal(ui.run('dirty'),true);assert.match(ui.get('notice').textContent,/Connection timed out/);
        assert.equal(ui.get('saveBtn').disabled,false);
    }
});

test('Already-saved draft recovery waits for online confirmation and keeps intervening edits',async()=>{
    for(const edited of [false,true]){
        const read=deferred(),draft=order({revision:0}),ui=page({draft,cached:[order()],hash:'#draft=loading-test',fetch:()=>read.promise});
        assert.equal(ui.run('activeOrder.revision'),0);assert.equal(ui.cleared.length,0);
        if(edited)ui.edit('clientName','New draft edit');
        read.resolve(response({orders:[order({clientName:'Confirmed client'})]}));await ui.loading;
        if(edited){
            assert.equal(ui.run('activeOrder.revision'),0);assert.equal(ui.get('clientName').value,'New draft edit');
            assert.equal(ui.run('dirty'),true);assert.equal(ui.cleared.length,0);
            assert.match(ui.get('notice').textContent,/მონახაზი უკვე შენახულია/);
        }else{
            assert.equal(ui.run('activeOrder.revision'),1);assert.equal(ui.get('clientName').value,'Confirmed client');
            assert.deepEqual(ui.cleared,['loading-test']);assert.equal(ui.location.hash,'#order=loading-test');
        }
    }
});

test('A late initial refresh cannot undo a newly saved order or restore a deletion on screen',async()=>{
    for(const action of ['save','delete']){
        const read=deferred();let reads=0,server=[order()];
        const ui=page({cached:server,hash:'#order=loading-test',fetch:async(url,options)=>{
            if(!options.method)return ++reads===1?read.promise:response({orders:server});
            const data=JSON.parse(options.body);
            if(data.action==='delete'){server=[];return response({deletedId:'loading-test'});}
            server=[{...data.order,revision:2}];return response({order:server[0]});
        }});
        if(action==='save'){ui.edit('clientName','Newly saved client');await ui.submit();}
        else{ui.get('deleteBtn').handlers.click();await ui.get('confirmDeleteBtn').handlers.click();}
        read.resolve(response({orders:[order()]}));await ui.loading;
        if(action==='save'){
            assert.equal(ui.run('activeOrder.revision'),2);assert.equal(ui.get('clientName').value,'Newly saved client');
        }else{
            assert.equal(ui.run('activeOrder'),null);assert.equal(ui.api.cachedOrders().length,0);
            assert.doesNotMatch(ui.get('orderRows').innerHTML,/Test event/);
        }
    }
});

test('A refresh finishing during a save cannot unlock or replace the form',async()=>{
    const read=deferred(),write=deferred();
    const ui=page({cached:[order()],hash:'#order=loading-test',fetch:(url,options)=>options.method?write.promise:read.promise});
    ui.edit('clientName','Saving client');const saving=ui.submit();
    read.resolve(response({orders:[order()]}));await ui.loading;
    assert.equal(ui.get('formFields').disabled,true);assert.equal(ui.get('clientName').value,'Saving client');
    write.resolve(response({order:order({clientName:'Saving client',revision:2})}));await saving;
    assert.equal(ui.get('formFields').disabled,false);assert.equal(ui.run('activeOrder.revision'),2);
});

test('A delayed save superseded by deletion retains input without reopening a confirmed order',async()=>{
    const write=deferred();let server=[order()];
    const ui=page({cached:server,hash:'#order=loading-test',fetch:async(url,options)=>{
        if(!options.method)return response({orders:structuredClone(server)});
        const data=JSON.parse(options.body);
        if(data.action==='delete'){server=[];return response({deletedId:'loading-test'});}
        server=[{...data.order,revision:2}];return write.promise;
    }});
    await ui.loading;ui.edit('clientName','Unfinished client');const pending=ui.submit();
    const saved=(await ui.api.list())[0];await ui.api.remove(saved);
    write.resolve(response({order:saved}));await pending;
    assert.equal(ui.run('activeOrder.revision'),1);assert.equal(ui.run('dirty'),true);
    assert.equal(ui.get('clientName').value,'Unfinished client');assert.equal(ui.api.cachedOrders().length,0);
    assert.match(ui.get('notice').textContent,/წაიშალა/);assert.match(ui.get('saveState').textContent,/ვერ შეინახა/);
});
