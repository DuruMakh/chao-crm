const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const CrmModel=require('../crm-model.js');

async function page(list,search='?order=staff-test') {
    const elements=new Map();
    function element() {
        return {textContent:'',hidden:false,disabled:false,children:[],classList:{toggle(){}},
            setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];},
            append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},
            addEventListener(name,listener){this[name]=listener;}};
    }
    const document={title:'',createElement:element,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);}};
    const context=vm.createContext({document,location:{search},URLSearchParams,CrmModel,CrmApi:{list},window:{print(){}}});
    await vm.runInContext(fs.readFileSync(require.resolve('../staff-sheet.js'),'utf8'),context);
    return id=>document.getElementById(id);
}
const order={id:'staff-test',name:'Team event',clientName:'Nino',companyName:'Example',companyCode:'PRIVATE_CODE',email:'billing@example.com',
    phone:'555 000 111',eventDate:'2026-10-24',eventTime:'18:00',location:'თვითგატანა (კლიენტი მოაკითხავს)',guests:30,status:'confirmed',
    notes:'Ready by 17:00\nPickup at 17:30',updatedAt:'2026-10-19T10:00:00.000Z',pricing:'snapshot',
    total:900,paid:300,serviceFee:20,transportFee:10,items:[{name:'Canape',qty:30,price:29}]};

test('Staff sheet includes saved logistics and product quantities without billing columns',async()=>{
    const get=await page(async()=>[order]);
    assert.equal(get('eventDate').textContent,'24.10.2026');
    assert.equal(get('eventTime').textContent,'18:00');
    assert.equal(get('location').textContent,order.location);
    assert.equal(get('notes').textContent,order.notes);
    assert.equal(get('updatedAt').textContent,'განახლდა: 19/10/2026, 14:00');
    assert.deepEqual(get('menuRows').children.map(row=>row.children.map(cell=>cell.textContent)),[['Canape','30']]);
    assert.equal(get('staffSheet').hidden,false);
    assert.equal(get('printBtn').disabled,false);
});

test('Legacy quantities remain printable without prices; missing logistics and empty menus are explicit',async()=>{
    const get=await page(async()=>[{...order,pricing:'legacy',eventDate:'',eventTime:'',location:'',items:[{name:'Legacy dish',qty:12,price:null}]}]);
    assert.deepEqual(get('menuRows').children.map(row=>row.children.map(cell=>cell.textContent)),[['Legacy dish','12']]);
    for(const id of ['eventDate','eventTime','location'])assert.equal(get(id).textContent,'დასაზუსტებელია');
    const empty=await page(async()=>[{...order,items:[],notes:''}]);
    assert.equal(empty('emptyMenu').hidden,false);
    assert.equal(empty('menuTable').hidden,true);
    assert.equal(empty('notesSection').hidden,true);
});

test('Unavailable or missing orders never expose an empty printable sheet',async()=>{
    for(const list of [async()=>{throw new Error('Offline');},async()=>[]]) {
        const get=await page(list);
        assert.equal(get('staffSheet').hidden,true);
        assert.equal(get('printBtn').disabled,true);
        assert.equal(get('retryBtn').hidden,false);
        assert.equal(get('whatsappLink').href,undefined);
        assert.equal(get('whatsappLink')['aria-disabled'],'true');
        assert.equal(get('shareHint').hidden,true);
        assert.notEqual(get('loadState').textContent,'');
    }
});

test('WhatsApp sharing prepares the complete Georgian staff message without a recipient or billing fields',async()=>{
    const saved={...order,name:'ნინოს ღონისძიება & გუნდი #1',items:[{name:'კანაპე & ყველი',qty:30,price:29},{name:'დესერტი',qty:12,price:5}]};
    const get=await page(async()=>[saved]);
    const url=new URL(get('whatsappLink').href);
    assert.equal(url.origin,'https://wa.me');
    assert.equal(url.pathname,'/');
    assert.deepEqual([...url.searchParams.keys()],['text']);
    const text=url.searchParams.get('text');
    for(const part of [saved.name,'დადასტურებული','24.10.2026','18:00','სტუმრები: 30',saved.location,saved.clientName,saved.companyName,saved.phone,'• კანაპე & ყველი: 30','• დესერტი: 12',saved.notes,saved.id]) {
        assert.ok(text.includes(part),part);
    }
    for(const part of [saved.companyCode,saved.email,'900','300','29','127.0.0.1','undefined'])assert.ok(!text.includes(part),part);
    assert.equal(get('whatsappLink')['aria-disabled'],undefined);
    assert.equal(get('whatsappLink').tabIndex,0);
    assert.equal(get('shareHint').hidden,false);
});

test('WhatsApp sharing explains missing details and is cleared if a reload fails',async()=>{
    let fail=false;
    const get=await page(async()=>{
        if(fail)throw new Error('Offline');
        return [{...order,name:'',eventDate:'',eventTime:'',guests:0,location:'',items:[],notes:''}];
    });
    const text=new URL(get('whatsappLink').href).searchParams.get('text');
    for(const label of ['ღონისძიების თარიღი','დაწყების დრო','სტუმრები','ადგილი / თვითგატანა'])assert.ok(text.includes(`${label}: დასაზუსტებელია`));
    assert.ok(text.includes(order.clientName));
    assert.ok(text.includes('მენიუ ჯერ არ არის დამატებული.'));
    assert.ok(!text.includes('*შენიშვნები*'));
    fail=true;
    await get('retryBtn').click();
    assert.equal(get('whatsappLink').href,undefined);
    assert.equal(get('whatsappLink')['aria-disabled'],'true');
    assert.equal(get('whatsappLink').tabIndex,-1);
});
