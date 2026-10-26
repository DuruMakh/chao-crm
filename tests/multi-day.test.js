const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('../crm-model.js');

const item=(qty,price=5)=>({name:'Lunch',qty,price});
const service=(id,name,guests,items,time='')=>({id,name,guests,items,time});
const schedule=()=>[
    {id:'day-2',date:'2026-11-11',services:[service('coffee-2','Coffee',35,[item(35,2)],'15:00'),service('lunch-2','Lunch',40,[item(40)],'12:00')]},
    {id:'day-1',date:'2026-11-10',services:[service('lunch-1','Lunch',30,[item(30)],'13:00'),service('coffee-1','Coffee',25,[{name:'Dessert',qty:50,price:1.5}],'15:30')]},
];
const input=()=>({id:'multi-test',name:'Two-day conference',eventDate:'',eventTime:'',guests:0,status:'enquiry',pricing:'snapshot',
    items:[],schedule:schedule(),serviceFee:20,transportFee:10,paid:100});

test('A two-day order keeps four distinct menus, counts, prices and times with one exact total',()=>{
    const order=model.validate(input());
    assert.equal(order.total,525);
    assert.equal(model.balance(order),425);
    assert.equal(order.guests,40,'Use the largest service count, not repeat attendees added together');
    assert.equal(order.eventDate,'2026-11-10');assert.equal(order.eventTime,'13:00');
    assert.deepEqual(order.schedule.map(day=>day.id),['day-1','day-2']);
    assert.deepEqual(order.schedule[1].services.map(meal=>meal.id),['lunch-2','coffee-2']);
    assert.deepEqual(order.items,[item(70),{name:'Dessert',qty:50,price:1.5},item(35,2)]);
    assert.equal(model.dateRange(order),'10.11.2026 – 11.11.2026');
    const groups=model.menuGroups(order);
    assert.equal(groups.length,4);assert.match(groups[3].title,/11\.11\.2026 · 15:00 · Coffee · 35/);
    assert.equal(groups[0].items[0].qty,30);assert.equal(groups[2].items[0].qty,40);
});

test('Sheet storage round trips each service and preserves older rows as single-day orders',()=>{
    const order={...model.validate(input()),createdAt:'2026-10-26',updatedAt:'2026-10-26',revision:1,lastRequestId:'save'};
    const items=order.items.map(line=>[order.id,line.name,line.qty,line.price]);
    assert.deepEqual(model.fromRows([model.toRow(order)],items)[0],order);
    const old=model.toRow({...order,schedule:null}).slice(0,22);
    assert.equal(model.fromRows([old],items)[0].schedule,null);
});

test('Schedules reject impossible or duplicate dates, missing names, bad times, guests and quantities',()=>{
    for(const change of [
        plan=>plan.splice(0), plan=>plan[0].date='2026-02-30', plan=>plan[0].date='',
        plan=>plan[0].date=plan[1].date, plan=>plan[0].id=plan[1].id,
        plan=>plan[0].services=[], plan=>plan[0].services[0].name=' ',
        plan=>plan[0].services[0].time='25:00', plan=>plan[0].services[0].guests=-1,
        plan=>plan[0].services[0].guests=2.5, plan=>plan[0].services[0].items[0].qty=1.2,
        plan=>plan[0].services[0].items[0].price=-1,
        plan=>plan[0].services[0].items.push({...plan[0].services[0].items[0]}),
        plan=>plan[0].services[0].id=plan[1].services[0].id,
    ]) {
        const draft=input();change(draft.schedule);
        assert.throws(()=>model.validate(draft),{code:'VALIDATION'});
    }
});

test('Partial planning permits empty menus and optional times, with explicit empty groups',()=>{
    const draft=input();draft.schedule[0].services[0].items=[];draft.schedule[0].services[0].time='';
    draft.schedule[0].services[0].guests=0;
    const saved=model.validate(draft),empty=model.menuGroups(saved).find(group=>!group.items.length);
    assert.match(empty.title,/სტუმრები დასაზუსტებელია/);
    assert.equal(saved.total,455);
});

test('Older pages cannot overwrite multi-day plans, and legacy orders require explicit repricing',()=>{
    const saved={...model.validate(input()),revision:1};
    const context=vm.createContext({CrmModel:model});
    vm.runInContext(fs.readFileSync(require.resolve('../google-apps-script.js'),'utf8'),context);
    const request={version:2,action:'save',requestId:'old-page',order:{...saved,paid:200}};
    assert.throws(()=>context.prepareSave(request,[saved],'now'),{code:'UPDATE_REQUIRED'});
    request.scheduleVersion=1;
    assert.throws(()=>context.prepareSave(request,[saved],'now'),{code:'UPDATE_REQUIRED'});
    request.scheduleVersion=2;
    assert.equal(context.prepareSave(request,[saved],'now').order.paid,200);
    const legacy={...input(),pricing:'legacy'};
    assert.throws(()=>model.validate(legacy),{code:'REPRICE_REQUIRED'});
    const stale={...saved};delete stale.schedule;
    assert.throws(()=>model.validate(stale,saved),{code:'UPDATE_REQUIRED'});
});

test('Each day adds its own fees exactly once regardless of how many meals it contains',()=>{
    const draft=input();
    draft.schedule[0].serviceFee=12.34;draft.schedule[0].transportFee=7.66;
    draft.schedule[1].serviceFee=25;draft.schedule[1].transportFee=10;
    draft.serviceFee=999;draft.transportFee=999;
    const saved=model.validate(draft);
    assert.equal(saved.serviceFee,37.34);assert.equal(saved.transportFee,17.66);
    assert.equal(saved.total,550);
    assert.equal(model.dayTotal(saved.schedule[0]),260);
    assert.equal(model.dayTotal(saved.schedule[1]),290);
    assert.equal(model.total(saved),550);
    const read=model.fromRows([model.toRow({...saved,revision:1})],saved.items.map(item=>[saved.id,item.name,item.qty,item.price]))[0];
    assert.equal(read.schedule[0].serviceFee,25);assert.equal(read.schedule[1].transportFee,7.66);
    assert.equal(model.total(read),550);
});

test('Earlier plans move their one-time fees to the first day without multiplying the quote',()=>{
    const draft=input(),original=JSON.stringify(draft),plan=model.scheduleWithFees(draft);
    assert.equal(plan[0].serviceFee,20);assert.equal(plan[0].transportFee,10);
    assert.equal(plan[1].serviceFee,0);assert.equal(plan[1].transportFee,0);
    assert.equal(JSON.stringify(draft),original);
    assert.equal(model.total(draft),525);
    assert.equal(model.validate(draft).total,525);
});

test('Daily fees reject negative and nonnumeric values, and an explicit zero stays zero',()=>{
    for(const value of [-1,'bad',Infinity]) {
        const draft=input();draft.schedule[0].serviceFee=value;
        assert.throws(()=>model.validate(draft),{code:'VALIDATION'});
        delete draft.schedule[0].serviceFee;draft.schedule[1].transportFee=value;
        assert.throws(()=>model.validate(draft),{code:'VALIDATION'});
    }
    const draft=input();
    for(const day of draft.schedule){day.serviceFee=0;day.transportFee=0;}
    const saved=model.validate(draft);
    assert.equal(saved.serviceFee,0);assert.equal(saved.transportFee,0);assert.equal(saved.total,495);
});
