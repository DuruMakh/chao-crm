const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {File}=require('node:buffer');
const InvoicePdf=require('../invoice-pdf.js');

function page({supported=false,share=async()=>{},fetch=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2]).buffer})}={}) {
    const elements=new Map(),downloads=[],built=[];
    const make=()=>({textContent:'',hidden:false,disabled:false,handlers:{},classList:{contains(){return false;},add(){},remove(){},toggle(){}},
        addEventListener(name,fn){this.handlers[name]=fn;},remove(){},click(){downloads.push(this.download);}});
    const get=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);};
    for(const [id,text] of Object.entries({prevInvoiceNumber:'TEST-1',prevInvoiceDate:'19.10.2026',prevInvoiceDueDate:'24.10.2026',prevPayerName:'ტესტი',prevPayerId:'00123'}))get(id).textContent=text;
    const cell=text=>({textContent:text,colSpan:1,classList:{contains(){return false;}}});
    get('prevInvoiceTable').tHead={rows:[{cells:[cell('პროდუქტი'),cell('რაოდენობა')]}]};
    get('prevInvoiceTable').tBodies=[{rows:[{cells:[cell('კანაპე'),cell('30')],classList:{contains(){return false;}}}]}];
    const document={getElementById:get,createElement:make,querySelectorAll:()=>[{textContent:'CHAO'}],body:{append(){}}};
    const context=vm.createContext({document,navigator:{canShare:()=>supported,share},fetch,File,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64'),
        URL:{createObjectURL:f=>{built.push(f);return 'blob:test';},revokeObjectURL(){}},setTimeout(){},
        InvoicePdf:{filename:InvoicePdf.filename,build:invoice=>Buffer.from(JSON.stringify(invoice))}});
    vm.runInContext(fs.readFileSync(require.resolve('../invoice-files.js'),'utf8'),context);
    return {get,downloads,built,prepare:context.InvoiceFiles.prepare};
}

test('Direct download uses the latest invoice filename and a PDF File without opening print',async()=>{
    const ui=page();await ui.prepare();
    assert.equal(ui.get('invoiceSharePdfBtn').disabled,true);
    assert.match(ui.get('invoiceSharePdfBtn').title,/მიუწვდომელია/);
    assert.equal(ui.get('invoiceDownloadBtn').disabled,false);
    ui.get('invoiceDownloadBtn').handlers.click();
    assert.deepEqual(ui.downloads,['Chao-Invoice-TEST-1.pdf']);
    assert.equal(ui.built[0].type,'application/pdf');
    ui.get('prevInvoiceNumber').textContent='TEST-2';await ui.prepare();
    ui.get('invoiceDownloadBtn').handlers.click();
    assert.equal(ui.downloads[1],'Chao-Invoice-TEST-2.pdf');
    assert.equal(JSON.parse(await ui.built[1].text()).payerId,'00123');
});

test('Native sharing receives the prepared PDF immediately in the click handler',async()=>{
    let payload;
    const ui=page({supported:true,share:data=>{payload=data;return Promise.resolve();}});
    await ui.prepare();
    assert.equal(ui.get('invoiceSharePdfBtn').hidden,false);
    const result=ui.get('invoiceSharePdfBtn').handlers.click();
    assert.equal(payload.files[0].name,'Chao-Invoice-TEST-1.pdf');
    assert.equal(payload.files[0].type,'application/pdf');
    assert.equal(payload.url,undefined);
    await result;
    assert.deepEqual(ui.downloads,[]);
    assert.equal(ui.get('invoiceSharePdfBtn').disabled,false);
});

test('Cancelling or failing native sharing keeps download available and never claims delivery',async()=>{
    for(const name of ['AbortError','NotAllowedError']) {
        const ui=page({supported:true,share:async()=>{const error=new Error();error.name=name;throw error;}});
        await ui.prepare();await ui.get('invoiceSharePdfBtn').handlers.click();
        assert.deepEqual(ui.downloads,[]);
        assert.equal(ui.get('invoiceDownloadBtn').disabled,false);
        assert.equal(ui.get('invoiceSharePdfBtn').disabled,false);
        assert.match(ui.get('invoiceFileStatus').textContent,/გაუქმდა|ვერ გაიხსნა/);
    }
});

test('Failed font loading cannot download an empty PDF and can be retried',async()=>{
    let fail=true;
    const ui=page({fetch:async()=>{if(fail)throw new Error('offline');return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};}});
    await ui.prepare();
    assert.equal(ui.get('invoiceDownloadBtn').disabled,true);
    assert.equal(ui.get('invoicePdfRetry').hidden,false);
    ui.get('invoiceDownloadBtn').handlers.click();assert.deepEqual(ui.downloads,[]);
    fail=false;await ui.get('invoicePdfRetry').handlers.click();
    assert.equal(ui.get('invoiceDownloadBtn').disabled,false);
});

test('Edits during font loading discard the previous invoice instead of exporting stale values',async()=>{
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    const ui=page({fetch:async()=>{await gate;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};}});
    const first=ui.prepare();
    ui.get('prevInvoiceNumber').textContent='LATEST';ui.get('prevPayerName').textContent='ახალი კლიენტი';
    const second=ui.prepare();
    assert.equal(ui.get('invoiceDownloadBtn').disabled,true);
    release();await Promise.all([first,second]);
    ui.get('invoiceDownloadBtn').handlers.click();
    assert.deepEqual(ui.downloads,['Chao-Invoice-LATEST.pdf']);
    assert.equal(JSON.parse(await ui.built[0].text()).payerName,'ახალი კლიენტი');
});

test('Invoice filenames preserve Georgian and exclude path separators and invalid filename characters',()=>{
    assert.equal(InvoicePdf.filename('ტესტი/1:*?'),'Chao-Invoice-ტესტი-1---.pdf');
    assert.equal(InvoicePdf.filename('   '),'Chao-Invoice-წინასწარი.pdf');
});

test('Preliminary PDF downloads and native shares receive the same Georgian filename',async()=>{
    let payload;
    const ui=page({supported:true,share:data=>{payload=data;return Promise.resolve();}});
    ui.get('prevInvoiceNumber').textContent='წინასწარი';
    await ui.prepare();
    ui.get('invoiceDownloadBtn').handlers.click();
    await ui.get('invoiceSharePdfBtn').handlers.click();
    assert.equal(ui.downloads[0],'Chao-Invoice-წინასწარი.pdf');
    assert.equal(payload.files[0].name,ui.downloads[0]);
    assert.equal(payload.title,ui.downloads[0]);
    assert.equal(JSON.parse(await payload.files[0].text()).number,'წინასწარი');
});
