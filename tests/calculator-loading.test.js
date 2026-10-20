const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const CrmModel=require('../crm-model.js');

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(setImmediate);
const csv='Name,Notes,Price\nMenu,,\nCanape,,99\nDessert,,8\n';
const response=(text=csv)=>({ok:true,text:async()=>text});
const order=()=>({id:'fictional',revision:2,name:'Event',clientName:'Client',pricing:'snapshot',items:[{name:'Canape',price:5,qty:2},{name:'Removed dish',price:7,qty:3}],serviceFee:10,transportFee:4,guests:20,total:45});

function calculator({search='?order=fictional',list=async()=>[order()],fetch=async()=>response(),draft=order()}={}) {
    const elements=new Map(),renders=[],requests=[],pdfCalls=[];
    function element() {
        const classes=new Set(),children=[],handlers={};
        let html='';
        return {value:'',textContent:'',style:{},dataset:{},disabled:false,hidden:false,children,handlers,
            get innerHTML(){return html||this.textContent.replaceAll('&','&amp;').replaceAll('<','&lt;');},
            set innerHTML(value){html=value;children.length=0;},
            classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){if(on)classes.add(c);else classes.delete(c);}},
            addEventListener(name,fn){handlers[name]=fn;},appendChild(child){children.push(child);},querySelector(){return element();},
            setAttribute(){},focus(){},reportValidity(){return true;}};
    }
    const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
    get('invoiceModal').classList.add('hidden');
    const location={search},history={replaceState(a,b,url){location.search=url.slice(url.indexOf('?'));}};
    let listCalls=0,created=0;
    const document={getElementById:get,createElement:element,querySelector(){return null;},
        querySelectorAll:selector=>selector.includes('#serviceFeeInput')?[get('serviceFeeInput'),get('transportFeeInput'),get('peopleCountInput')]:[],
        addEventListener(){}};
    const context=vm.createContext({document,location,history,URLSearchParams,CrmModel,renders,
        window:{addEventListener(){}},AbortSignal:{timeout:ms=>({timeout:ms})},
        fetch:(url,options)=>{requests.push({url,options});return fetch(url,options);},
        CrmApi:{list:()=>{listCalls++;return list();}},
        CrmDraft:{load:()=>draft,create:()=>{created++;return draft;}},
        InvoiceFiles:{prepare:()=>pdfCalls.push('prepare'),schedule:()=>pdfCalls.push('schedule'),cancel:()=>pdfCalls.push('cancel')}});
    for(const file of ['app.js','calculator-orders.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),context);
    vm.runInContext('const originalRender=renderProducts;renderProducts=(list,filtered)=>{renders.push(list.map(p=>({...p,category:null})));return originalRender(list,filtered);};',context);
    return {get,location,renders,requests,pdfCalls,run:code=>vm.runInContext(code,context),get listCalls(){return listCalls;},get created(){return created;}};
}

test('Saved-menu data requests start together and render once with saved prices and missing products',async()=>{
    const orders=deferred(),catalog=deferred();
    const ui=calculator({list:()=>orders.promise,fetch:()=>catalog.promise});
    const loading=ui.run('initCalculator()');
    assert.equal(ui.listCalls,1);assert.equal(ui.requests.length,1);
    assert.equal(ui.requests[0].options.signal.timeout,10000);
    catalog.resolve(response());await settle();
    assert.equal(ui.renders.length,0);
    orders.resolve([order()]);await loading;
    assert.equal(ui.renders.length,1);
    assert.equal(ui.renders[0].find(p=>p.name==='Canape').price,5);
    assert.equal(ui.renders[0].find(p=>p.name==='Removed dish').price,7);
    assert.equal(ui.run('getCurrentOrderSummary().total'),45);
    assert.equal(ui.run('catalogPrices.get("Canape")'),99);
    assert.equal(ui.get('saveOrderBtn').disabled,false);
});

test('Invoice entry waits for confirmation without a catalog, then catalog failure and retry preserve its saved menu',async()=>{
    const orders=deferred(),catalog=deferred();let calls=0;
    const ui=calculator({search:'?order=fictional&invoice=1',list:()=>orders.promise,fetch:()=>++calls===1?catalog.promise:Promise.resolve(response())});
    const loading=ui.run('initCalculator()');
    assert.equal(ui.requests.length,0);
    assert.equal(ui.get('invoiceModal').classList.contains('hidden'),true);
    orders.resolve([order()]);await loading;
    assert.equal(ui.requests.length,0);assert.equal(ui.renders.length,0);
    assert.equal(ui.get('invoiceModal').classList.contains('hidden'),false);
    assert.match(ui.get('prevInvoiceTable').innerHTML,/45\.00/);
    assert.deepEqual(ui.pdfCalls,['prepare']);
    ui.run('closeInvoiceModal()');
    assert.equal(ui.requests.length,1);assert.equal(ui.get('saveOrderBtn').disabled,true);
    catalog.reject(Object.assign(new Error('timed out'),{name:'TimeoutError'}));await settle();
    assert.equal(ui.run('getCurrentOrderSummary().total'),45);
    assert.equal(ui.get('errorState').classList.contains('hidden'),false);
    await ui.get('retryBtn').handlers.click();
    assert.equal(ui.listCalls,1);assert.equal(ui.renders.length,1);
    assert.equal(ui.run('getCurrentOrderSummary().total'),45);
    assert.equal(ui.renders[0].find(p=>p.name==='Canape').price,5);
});

test('Legacy invoice snapshots preserve unknown prices and their original total without catalog access',async()=>{
    const legacy={...order(),pricing:'legacy',total:543.21,items:[{name:'Old dish',qty:30,price:null}]};
    const ui=calculator({search:'?order=fictional&invoice=1',list:async()=>[legacy]});
    await ui.run('initCalculator()');
    assert.equal(ui.requests.length,0);
    assert.equal(ui.run('getCurrentOrderSummary().items[0].price'),null);
    assert.match(ui.get('prevInvoiceTable').innerHTML,/543\.21/);
    assert.equal(ui.get('saveOrderBtn').disabled,true);
});

test('A missing or failed server confirmation cannot open an invoice from cached data',async()=>{
    for(const list of [async()=>[],async()=>{throw new Error('offline');}]) {
        const ui=calculator({search:'?order=fictional&invoice=1',list});
        await ui.run('initCalculator()');
        assert.equal(ui.requests.length,0);
        assert.equal(ui.get('invoiceModal').classList.contains('hidden'),true);
        assert.equal(ui.pdfCalls.length,0);
        assert.equal(ui.get('invoiceBtn').disabled,true);
        assert.equal(ui.get('errorState').classList.contains('hidden'),false);
    }
});

test('New draft timeout and retry reuse the draft and preserve its quantities, guests and fees',async()=>{
    const draft={...order(),revision:0};let calls=0;
    const ui=calculator({search:'',draft,fetch:async()=>{if(++calls===1)throw Object.assign(new Error('timeout'),{name:'TimeoutError'});return response();}});
    await ui.run('initCalculator()');
    assert.equal(ui.created,1);assert.equal(ui.listCalls,0);assert.equal(ui.renders.length,0);
    await ui.get('retryBtn').handlers.click();
    assert.equal(ui.created,1);assert.equal(ui.listCalls,0);assert.equal(ui.renders.length,1);
    assert.equal(ui.get('peopleCountInput').value,20);
    assert.equal(ui.get('serviceFeeInput').value,10);
    assert.equal(ui.run('getCurrentOrderSummary().total'),45);
});

test('A superseded calculator load cannot replace a newer confirmed order or render a second time',async()=>{
    const first=deferred(),second=deferred();let calls=0;
    const ui=calculator({list:()=>++calls===1?first.promise:second.promise});
    const oldLoad=ui.run('initCalculator()'),newLoad=ui.run('initCalculator()');
    second.resolve([{...order(),revision:3,items:[{name:'Canape',price:20,qty:1}],total:34}]);await newLoad;
    first.resolve([order()]);await oldLoad;
    assert.equal(ui.run('activeCrmOrder.revision'),3);
    assert.equal(ui.run('getCurrentOrderSummary().total'),34);
    assert.equal(ui.renders.length,1);
});

test('An empty invoice link falls back to usable menu editing instead of an endless loading screen',async()=>{
    const ui=calculator({search:'?order=fictional&invoice=1',list:async()=>[{...order(),items:[],serviceFee:0,transportFee:0,total:0}]});
    await ui.run('initCalculator()');await settle();
    assert.equal(ui.requests.length,1);
    assert.equal(ui.get('invoiceModal').classList.contains('hidden'),true);
    assert.equal(ui.get('productsContainer').classList.contains('hidden'),false);
    assert.equal(ui.get('saveOrderBtn').disabled,false);
});
