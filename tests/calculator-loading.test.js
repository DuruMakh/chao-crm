const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const CrmModel=require('../crm-model.js');
const DateInput=require('../date-input.js');

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(setImmediate);
const csv='Name,Notes,Price\nMenu,,\nCanape,,99\nDessert,,8\n';
const response=(text=csv)=>({ok:true,text:async()=>text});
const order=()=>({id:'fictional',revision:2,name:'Event',clientName:'Client',pricing:'snapshot',items:[{name:'Canape',price:5,qty:2},{name:'Removed dish',price:7,qty:3}],serviceFee:10,transportFee:4,guests:20,total:45});

function calculator({search='?order=fictional',list=async()=>[order()],fetch=async()=>response(),draft=order(),save=async draft=>({...draft,revision:3}),draftSave=()=>{},confirm=()=>true}={}) {
    const elements=new Map(),renders=[],requests=[],pdfCalls=[];
    function element() {
        const classes=new Set(),children=[],handlers={};
        let html='';
        return {value:'',textContent:'',style:{},dataset:{},disabled:false,hidden:false,children,handlers,
            get innerHTML(){return html||this.textContent.replaceAll('&','&amp;').replaceAll('<','&lt;');},
            set innerHTML(value){html=value;children.length=0;},
            classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){if(on)classes.add(c);else classes.delete(c);}},
            setCustomValidity(value){this.validationMessage=value;},addEventListener(name,fn){const previous=handlers[name];handlers[name]=previous?(...args)=>{previous(...args);return fn(...args);}:fn;},appendChild(child){children.push(child);},querySelector(){return element();},
            setAttribute(){},focus(){},reportValidity(){return true;}};
    }
    const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
    get('invoiceModal').classList.add('hidden');
    const location={search},history={replaceState(a,b,url){location.search=url.slice(url.indexOf('?'));}};
    let listCalls=0,created=0;
    const document={getElementById:get,createElement:element,querySelector(){return null;},
        querySelectorAll:selector=>selector.includes('#serviceFeeInput')?[get('serviceFeeInput'),get('transportFeeInput'),get('peopleCountInput')]:[],
        addEventListener(){}};
    const context=vm.createContext({DateInput,document,location,history,URLSearchParams,CrmModel,renders,crypto:require('node:crypto'),confirm,
        window:{addEventListener(){}},AbortSignal:{timeout:ms=>({timeout:ms})},
        fetch:(url,options)=>{requests.push({url,options});return fetch(url,options);},
        CrmApi:{list:()=>{listCalls++;return list();},save},
        CrmDraft:{load:()=>draft,create:()=>{created++;return draft;},save:draftSave},
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
    assert.match(ui.get('prevInvoiceTable').innerHTML,/Old dish<\/td><td class="center-col">30<\/td><td class="num-col">—<\/td><td class="num-col">—/);
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

const plannedOrder=()=>({...order(),name:'Conference',status:'enquiry',eventDate:'2026-11-10',eventTime:'13:00',guests:30,total:94,
    schedule:[{id:'day1',date:'2026-11-10',services:[{id:'lunch1',name:'Lunch',time:'13:00',guests:30,items:[{name:'Canape',qty:10,price:5}]}]},
        {id:'day2',date:'2026-11-11',services:[{id:'coffee2',name:'Coffee',time:'10:00',guests:20,items:[{name:'Canape',qty:10,price:3}]}]}],
    items:[{name:'Canape',qty:10,price:5},{name:'Canape',qty:10,price:3}]});

test('Switching planned meals preserves separate guest counts, quantities and saved prices',async()=>{
    const ui=calculator({list:async()=>[plannedOrder()]});await ui.run('initCalculator()');
    assert.equal(ui.run('getCurrentOrderSummary().total'),94);
    ui.run('updateQuantity(0,12)');ui.get('peopleCountInput').value='35';
    ui.run('syncPlannedMenu();selectPlannedMenu(calculatorSchedule[1],calculatorSchedule[1].services[0]);');
    assert.equal(ui.get('peopleCountInput').value,20);assert.equal(ui.run('products[0].price'),3);
    assert.equal(ui.run('quantities[0]'),10);
    ui.run('updateQuantity(0,15);selectPlannedMenu(calculatorSchedule[0],calculatorSchedule[0].services[0]);');
    assert.equal(ui.get('peopleCountInput').value,35);assert.equal(ui.run('quantities[0]'),12);
    assert.equal(ui.run('products[0].price'),5);assert.equal(ui.run('getCurrentOrderSummary().total'),119);
});

test('Temporarily removing and restoring a product retains each meal\'s saved price across tab changes',async()=>{
    const ui=calculator({list:async()=>[plannedOrder()]});await ui.run('initCalculator()');
    const select=id=>ui.get('planDays').handlers.click({target:{closest:()=>({dataset:{day:id}})}});
    ui.run('updateQuantity(0,0)');select('day2');
    ui.run('updateQuantity(0,0)');select('day1');
    ui.run('updateQuantity(0,10)');
    assert.equal(ui.run('products[0].price'),5);
    select('day2');ui.run('updateQuantity(0,10)');
    assert.equal(ui.run('products[0].price'),3);
    assert.equal(ui.run('getCurrentOrderSummary().total'),94);
    ui.run('updateQuantity(1,2)');select('day1');select('day2');
    assert.equal(ui.run('products[1].price'),8,'New products still use current catalog prices');
    assert.equal(ui.run('getCurrentOrderSummary().total'),110);
});

test('Copying a day creates independent menus and switching to single-day cannot silently remove a plan',async()=>{
    const ui=calculator({list:async()=>[plannedOrder()]});await ui.run('initCalculator()');
    ui.get('copyDayBtn').handlers.click();
    assert.equal(ui.run('calculatorSchedule.length'),3);
    assert.equal(ui.run('selectedDay().date'),'2026-11-12');
    ui.run('updateQuantity(0,1)');
    assert.equal(ui.run('calculatorSchedule[0].services[0].items[0].qty'),10);
    assert.notEqual(ui.run('selectedServiceId'),ui.run('calculatorSchedule[0].services[0].id'));
    ui.run('setOrderMode(false)');
    assert.equal(ui.run('calculatorSchedule.length'),3);
    assert.match(ui.get('calculatorStatus').textContent,/ერთი დღე და ერთი კვება/);
});

test('Multi-day invoice-only entry uses all saved services without loading catalog prices',async()=>{
    const ui=calculator({search:'?order=fictional&invoice=1',list:async()=>[plannedOrder()]});
    await ui.run('initCalculator()');
    assert.equal(ui.requests.length,0);
    assert.equal(ui.run('getCurrentOrderSummary().total'),94);
    const html=ui.get('prevInvoiceTable').innerHTML;
    for(const text of ['10.11.2026','11.11.2026','Lunch','Coffee','30 სტუმარი','20 სტუმარი','94.00'])assert.ok(html.includes(text),text);
    assert.equal(ui.get('invoiceDueDate').value,'11.11.2026');
    assert.equal(ui.get('summaryDays').value,2);
    ui.run('closeInvoiceModal()');await settle();
    assert.equal(ui.run('getCurrentOrderSummary().total'),94);
});

test('A failed multi-day save keeps all meals and quantities available for an unchanged retry',async()=>{
    let attempt=0;const requests=[];
    const ui=calculator({list:async()=>[plannedOrder()],save:async draft=>{
        requests.push(JSON.parse(JSON.stringify(draft)));
        if(++attempt===1)throw new Error('Offline');return {...draft,revision:3};
    }});
    await ui.run('initCalculator()');ui.run('updateQuantity(0,12);markCalculatorDirty()');
    await ui.get('saveOrderBtn').handlers.click();
    assert.equal(ui.run('calculatorDirty'),true);assert.match(ui.get('calculatorStatus').textContent,/Offline/);
    assert.equal(ui.run('getCurrentOrderSummary().total'),104);
    await ui.get('saveOrderBtn').handlers.click();
    assert.deepEqual(requests[0],requests[1]);assert.equal(requests[1].schedule.length,2);
    assert.equal(ui.run('calculatorDirty'),false);assert.equal(ui.run('activeCrmOrder.revision'),3);
});

test('The menu-to-details draft handoff includes the full schedule, start date and largest guest count',async()=>{
    let saved;const draft={...plannedOrder(),revision:0};
    const ui=calculator({search:'?draft=fictional',draft,draftSave:value=>saved=value});
    await ui.run('initCalculator()');await ui.get('saveOrderBtn').handlers.click();
    assert.equal(saved.schedule.length,2);assert.equal(saved.eventDate,'2026-11-10');assert.equal(saved.guests,30);
    assert.equal(ui.location.href,'index.html#draft=fictional');
});

test('Invalid schedule dates never leave the editor or reach a save request',async()=>{
    let saved=false;const ui=calculator({list:async()=>[plannedOrder()],save:async()=>{saved=true;}});
    await ui.run('initCalculator()');ui.get('planDate').value='31.02.2026';
    await ui.get('saveOrderBtn').handlers.click();
    assert.equal(saved,false);assert.equal(ui.get('calculatorStatus').textContent,DateInput.message);
});

test('Single-day menus can enter and leave planning before a date is chosen without losing quantities',async()=>{
    const draft={...order(),revision:0,eventDate:'',eventTime:''};
    const ui=calculator({search:'?draft=fictional',draft});await ui.run('initCalculator()');
    ui.run('setOrderMode(true)');assert.equal(ui.run('calculatorSchedule.length'),1);
    assert.equal(ui.run('getCurrentOrderSummary().total'),45);
    ui.run('setOrderMode(false)');assert.equal(ui.run('calculatorSchedule'),null);
    assert.equal(ui.run('getCurrentOrderSummary().total'),45);assert.equal(ui.run('peopleCount'),20);
});

test('Cancelling a reset or day deletion keeps all menus and leaves a saved order clean',async()=>{
    const ui=calculator({list:async()=>[plannedOrder()],confirm:()=>false});await ui.run('initCalculator()');
    ui.get('resetBtn').handlers.click();ui.get('removeDayBtn').handlers.click();
    assert.equal(ui.run('calculatorDirty'),false);assert.equal(ui.run('calculatorSchedule.length'),2);
    assert.equal(ui.run('getCurrentOrderSummary().total'),94);
});

test('Resetting one planned meal preserves other days, guests and daily fees',async()=>{
    const ui=calculator({list:async()=>[plannedOrder()]});await ui.run('initCalculator()');
    ui.get('resetBtn').handlers.click();
    assert.equal(ui.run('selectedService().items.length'),0);
    assert.equal(ui.run('calculatorSchedule[1].services[0].items[0].qty'),10);
    assert.equal(ui.get('peopleCountInput').value,30);
    assert.equal(ui.run('getCurrentOrderSummary().total'),44);
    assert.equal(ui.run('calculatorDirty'),true);
});

test('Daily fees follow the selected date, survive meal changes and save as one combined quote',async()=>{
    const plan=plannedOrder(),requests=[];
    plan.schedule[0].services.push({id:'coffee1',name:'Coffee',time:'15:00',guests:10,items:[{name:'Canape',qty:2,price:4}]});
    plan.schedule[0].serviceFee=10;plan.schedule[0].transportFee=4;
    plan.schedule[1].serviceFee=20;plan.schedule[1].transportFee=6;
    const ui=calculator({list:async()=>[plan],save:async draft=>{requests.push(JSON.parse(JSON.stringify(draft)));return {...draft,revision:3};}});
    await ui.run('initCalculator()');
    const fee=(id,value)=>{ui.get(id).value=String(value);ui.get(id).handlers.input({target:ui.get(id)});};
    const select=(id,key,value)=>ui.get(id).handlers.click({target:{closest:()=>({dataset:{[key]:value}})}});
    assert.equal(ui.run('getCurrentOrderSummary().total'),128);
    fee('serviceFeeInput',15.25);fee('transportFeeInput',4.75);
    select('planServices','service','coffee1');
    assert.equal(ui.get('serviceFeeInput').value,15.25);assert.equal(ui.get('transportFeeInput').value,4.75);
    select('planDays','day','day2');
    assert.equal(ui.get('serviceFeeInput').value,20);assert.equal(ui.get('transportFeeInput').value,6);
    fee('serviceFeeInput',9);fee('transportFeeInput',1);
    assert.equal(ui.run('getCurrentOrderSummary().total'),118);
    assert.equal(ui.get('planCostBreakdown').hidden,false);
    for(const text of ['10.11.2026','11.11.2026','Lunch','Coffee','78.00','40.00','15.25','4.75'])assert.ok(ui.get('planDayTotals').innerHTML.includes(text),text);
    await ui.get('saveOrderBtn').handlers.click();
    assert.equal(requests[0].serviceFee,24.25);assert.equal(requests[0].transportFee,5.75);
    assert.equal(requests[0].total,118);assert.equal(requests[0].schedule[0].serviceFee,15.25);
    select('planDays','day','day1');assert.equal(ui.get('serviceFeeInput').value,15.25);
    ui.get('copyDayBtn').handlers.click();
    assert.equal(ui.get('serviceFeeInput').value,15.25);assert.equal(ui.run('getCurrentOrderSummary().total'),196);
    ui.get('addDayBtn').handlers.click();
    assert.equal(ui.get('serviceFeeInput').value,0);assert.equal(ui.get('transportFeeInput').value,0);
    assert.equal(ui.run('getCurrentOrderSummary().total'),196);
    ui.get('removeDayBtn').handlers.click();
    select('planDays','day',ui.run('calculatorSchedule[2].id'));
    ui.get('removeDayBtn').handlers.click();
    assert.equal(ui.run('getCurrentOrderSummary().total'),118);
});

test('Detailed invoices show saved unit prices and line amounts for single-day and multi-day menus',async()=>{
    for(const saved of [order(),plannedOrder()]) {
        const ui=calculator({search:'?order=fictional&invoice=1',list:async()=>[saved]});await ui.run('initCalculator()');
        const html=ui.get('prevInvoiceTable').innerHTML;
        assert.match(html,/ერთ\. ფასი/);assert.match(html,/თანხა/);
        if(saved.schedule) {
            assert.match(html,/Canape<\/td><td class="center-col">10<\/td><td class="num-col">₾ 5\.00<\/td><td class="num-col">₾ 50\.00/);
            assert.match(html,/Canape<\/td><td class="center-col">10<\/td><td class="num-col">₾ 3\.00<\/td><td class="num-col">₾ 30\.00/);
            assert.match(html,/10\.11\.2026 · დღის ჯამი:[\s\S]*?₾ 64\.00/);
            assert.match(html,/11\.11\.2026 · დღის ჯამი:[\s\S]*?₾ 30\.00/);
        } else {
            assert.match(html,/Canape<\/td><td class="center-col">2<\/td><td class="num-col">₾ 5\.00<\/td><td class="num-col">₾ 10\.00/);
            assert.match(html,/Removed dish<\/td><td class="center-col">3<\/td><td class="num-col">₾ 7\.00<\/td><td class="num-col">₾ 21\.00/);
            assert.equal(ui.get('planCostBreakdown').hidden,true);
        }
    }
});
