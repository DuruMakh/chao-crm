const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {File}=require('node:buffer');
const CrmModel=require('../crm-model.js');
const StaffPdf=require('../staff-pdf.js');

async function page(list,search='?order=staff-test',{supported=true,share=async()=>{},load=async()=>({})}={}) {
    const elements=new Map(),downloads=[],files=[];
    function element() {
        return {textContent:'',hidden:false,disabled:false,children:[],classList:{toggle(){}},
            setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];},
            append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},
            addEventListener(name,listener){this[name]=listener;},click(){downloads.push(this.download);},remove(){}};
    }
    const document={title:'',createElement:element,body:{append(){}},getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);}};
    const context=vm.createContext({document,location:{search},URLSearchParams,CrmModel,CrmApi:{list},window:{print(){}},
        File,navigator:{canShare:()=>supported,share},PdfAssets:{load},StaffPdf:{filename:StaffPdf.filename,build:order=>Buffer.from(JSON.stringify(order))},
        URL:{createObjectURL:file=>{files.push(file);return 'blob:test';},revokeObjectURL(){}},setTimeout(){}});
    await vm.runInContext(fs.readFileSync(require.resolve('../staff-sheet.js'),'utf8'),context);
    return Object.assign(id=>document.getElementById(id),{downloads,files,context});
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
        assert.equal(get('whatsappLink').disabled,true);
        assert.equal(get('downloadPdfBtn').disabled,true);
        assert.equal(get('shareHint').hidden,true);
        assert.notEqual(get('loadState').textContent,'');
    }
});

test('WhatsApp sharing receives a prepared PDF with an English order-name and guest-count filename, without text or a link',async()=>{
    const saved={...order,name:'ნინოს ღონისძიება & გუნდი #1',items:[{name:'კანაპე & ყველი',qty:30,price:29},{name:'დესერტი',qty:12,price:5}]};
    let payload,finish;
    const get=await page(async()=>[saved],'?order=staff-test',{share:data=>{payload=data;return new Promise(resolve=>{finish=resolve;});}});
    const sharing=get('whatsappLink').click();
    assert.deepEqual(Object.keys(payload),['files']);
    assert.equal(payload.files.length,1);
    assert.equal(payload.files[0].name,'Ninos-ghonisdzieba-gundi-1-30-People.pdf');
    assert.equal(payload.files[0].type,'application/pdf');
    assert.ok(payload.files[0].size>0);
    assert.equal(get('whatsappLink').disabled,true);
    finish();await sharing;
    assert.equal(get('whatsappLink').disabled,false);
    assert.equal(get('shareHint').hidden,false);
    get('downloadPdfBtn').click();
    assert.equal(get.downloads[0],payload.files[0].name);
    assert.equal(get.files[0],payload.files[0]);
});

test('A failed reload clears the previous PDF and disables both download and share',async()=>{
    let fail=false;
    const get=await page(async()=>{
        if(fail)throw new Error('Offline');
        return [{...order,name:'',eventDate:'',eventTime:'',guests:0,location:'',items:[],notes:''}];
    });
    get('downloadPdfBtn').click();
    assert.equal(get.downloads[0],'Nino.pdf');
    fail=true;
    await get('retryBtn').click();
    assert.equal(get('whatsappLink').href,undefined);
    assert.equal(get('whatsappLink').disabled,true);
    assert.equal(get('downloadPdfBtn').disabled,true);
    get('downloadPdfBtn').click();
    assert.equal(get.downloads.length,1);
});

test('Unsupported file sharing offers the PDF download without falling back to a text message',async()=>{
    let shares=0;
    const get=await page(async()=>[order],'?order=staff-test',{supported:false,share:async()=>{shares++;}});
    assert.equal(get('whatsappLink').disabled,true);
    assert.equal(get('downloadPdfBtn').disabled,false);
    assert.match(get('shareHint').textContent,/ჩამოტვირთეთ PDF/);
    await get('whatsappLink').click();
    assert.equal(shares,0);
    get('downloadPdfBtn').click();
    assert.equal(get.files[0].type,'application/pdf');
});

test('Cancelled and failed shares leave the staff PDF available for retry or download',async()=>{
    for(const name of ['AbortError','NotAllowedError']) {
        const get=await page(async()=>[order],'?order=staff-test',{share:async()=>{const error=new Error();error.name=name;throw error;}});
        await get('whatsappLink').click();
        assert.equal(get('whatsappLink').disabled,false);
        assert.equal(get('downloadPdfBtn').disabled,false);
        assert.match(get('shareHint').textContent,/გაუქმდა|ვერ გაიხსნა/);
    }
});

test('Failed PDF preparation keeps the staff view printable and retries without reloading the order',async()=>{
    let fail=true,loads=0;
    const get=await page(async()=>{loads++;return [order];},'?order=staff-test',{load:async()=>{if(fail)throw new Error('offline');return {};}});
    assert.equal(get('staffSheet').hidden,false);
    assert.equal(get('printBtn').disabled,false);
    assert.equal(get('downloadPdfBtn').disabled,true);
    assert.equal(get('whatsappLink').disabled,true);
    assert.equal(get('pdfRetryBtn').hidden,false);
    fail=false;await get('pdfRetryBtn').click();
    assert.equal(loads,1);
    assert.equal(get('downloadPdfBtn').disabled,false);
    assert.equal(get('whatsappLink').disabled,false);
    assert.equal(get('pdfRetryBtn').hidden,true);
});

test('A late PDF preparation cannot restore a stale file after an order reload fails',async()=>{
    const get=await page(async()=>[order]);
    let finish;
    get.context.PdfAssets.load=()=>new Promise(resolve=>{finish=resolve;});
    const preparation=get('pdfRetryBtn').click();
    get.context.CrmApi.list=async()=>{throw new Error('offline');};
    await get('retryBtn').click();
    finish({});await preparation;
    assert.equal(get('downloadPdfBtn').disabled,true);
    assert.equal(get('whatsappLink').disabled,true);
    get('downloadPdfBtn').click();
    assert.equal(get.downloads.length,0);
});

test('Staff filenames transliterate Georgian, remove unsafe characters and preserve the guest count',()=>{
    assert.equal(StaffPdf.filename({...order,name:'ფურშეტი / გუნდი:*?'}),'Pursheti-gundi-30-People.pdf');
    assert.equal(StaffPdf.filename({...order,name:'Équipe meeting',guests:12}),'Equipe-meeting-12-People.pdf');
    assert.equal(StaffPdf.filename({...order,name:'',guests:0}),'Nino.pdf');
});
