const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {File}=require('node:buffer');
const InvoicePdf=require('../invoice-pdf.js');

function page({supported=false,libraries=true,share=async()=>{},fetch=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2]).buffer})}={}) {
    const elements=new Map(),downloads=[],built=[],preparations=[],scripts=[],timers=new Map();
    let now=0,timerId=0;
    const make=()=>({textContent:'',value:'',hidden:false,disabled:false,handlers:{},listenerCounts:{},classList:{contains(){return false;},add(){},remove(){},toggle(){}},
        addEventListener(name,fn){this.handlers[name]=fn;this.listenerCounts[name]=(this.listenerCounts[name]||0)+1;},remove(){},click(){downloads.push(this.download);}});
    const get=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);};
    for(const [id,text] of Object.entries({prevInvoiceNumber:'TEST-1',prevInvoiceDate:'19.10.2026',prevInvoiceDueDate:'24.10.2026',prevPayerName:'ტესტი',prevPayerId:'00123'}))get(id).textContent=text;
    const cell=text=>({textContent:text,colSpan:1,classList:{contains(){return false;}}});
    get('prevInvoiceTable').tHead={rows:[{cells:[cell('პროდუქტი'),cell('რაოდენობა')]}]};
    get('prevInvoiceTable').tBodies=[{rows:[{cells:[cell('კანაპე'),cell('30')],classList:{contains(){return false;}}}]}];
    const document={getElementById:get,createElement:make,querySelectorAll:()=>[{textContent:'CHAO'}],body:{append(){}},head:{append:script=>scripts.push(script)}};
    const window=libraries?{jspdf:{jsPDF(){}},autoTable(){}}:{};
    const context=vm.createContext({document,window,peopleCount:30,activeInvoiceType:'detailed',navigator:{canShare:()=>supported,share},fetch,File,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64'),
        URL:{createObjectURL:f=>{built.push(f);return 'blob:test';},revokeObjectURL(){}},
        setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
        InvoicePdf:{filename:InvoicePdf.filename,build:invoice=>{preparations.push(invoice);return Buffer.from(JSON.stringify(invoice));}}});
    for(const source of ['pdf-assets.js','invoice-files.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+source),'utf8'),context);
    async function advance(ms) {
        now+=ms;
        for(const [id,timer] of timers) if(timer.at<=now){timers.delete(id);timer.fn();}
        await new Promise(setImmediate);
    }
    async function finishScript(index,success=true) {
        const script=scripts[index];
        if(success) {
            if(script.src.includes('autotable'))window.autoTable=()=>{};
            else window.jspdf={jsPDF(){}};
            script.onload();
        } else script.onerror();
        await new Promise(setImmediate);
    }
    return {get,downloads,built,preparations,scripts,advance,finishScript,context,...context.InvoiceFiles};
}

test('Direct download uses the latest invoice filename and a PDF File without opening print',async()=>{
    const ui=page();await ui.prepare();
    assert.equal(ui.get('invoiceSharePdfBtn').disabled,true);
    assert.match(ui.get('invoiceSharePdfBtn').title,/მიუწვდომელია/);
    assert.equal(ui.get('invoiceDownloadBtn').disabled,false);
    ui.get('invoiceDownloadBtn').handlers.click();
    assert.deepEqual(ui.downloads,['Invoice-30-People.pdf']);
    assert.equal(ui.built[0].type,'application/pdf');
    assert.equal(ui.preparations[0].type,'detailed');
    ui.get('prevInvoiceNumber').textContent='TEST-2';ui.context.peopleCount=45;await ui.prepare();
    ui.get('invoiceDownloadBtn').handlers.click();
    assert.equal(ui.downloads[1],'Invoice-45-People.pdf');
    assert.equal(JSON.parse(await ui.built[1].text()).payerId,'00123');
    ui.context.activeInvoiceType='summary';await ui.prepare();
    assert.equal(ui.preparations.at(-1).type,'summary');
});

test('Native sharing receives the prepared PDF immediately in the click handler',async()=>{
    let payload;
    const ui=page({supported:true,share:data=>{payload=data;return Promise.resolve();}});
    await ui.prepare();
    assert.equal(ui.get('invoiceSharePdfBtn').hidden,false);
    const result=ui.get('invoiceSharePdfBtn').handlers.click();
    assert.equal(payload.files[0].name,'Invoice-30-People.pdf');
    assert.equal(payload.files[0].type,'application/pdf');
    assert.equal(payload.url,undefined);
    assert.equal(payload.title,undefined);
    assert.equal(payload.text,undefined);
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
    assert.deepEqual(ui.downloads,['Invoice-30-People.pdf']);
    assert.equal(JSON.parse(await ui.built[0].text()).number,'LATEST');
    assert.equal(JSON.parse(await ui.built[0].text()).payerName,'ახალი კლიენტი');
});

test('Invoice filenames use the guest count and omit it when not specified',()=>{
    assert.equal(InvoicePdf.filename(30),'Invoice-30-People.pdf');
    assert.equal(InvoicePdf.filename(0),'Invoice.pdf');
});

test('Preliminary PDF downloads and shares use the same English guest-count filename without a text title',async()=>{
    let payload;
    const ui=page({supported:true,share:data=>{payload=data;return Promise.resolve();}});
    ui.get('prevInvoiceNumber').textContent='წინასწარი';
    await ui.prepare();
    ui.get('invoiceDownloadBtn').handlers.click();
    await ui.get('invoiceSharePdfBtn').handlers.click();
    assert.equal(ui.downloads[0],'Invoice-30-People.pdf');
    assert.equal(payload.files[0].name,ui.downloads[0]);
    assert.equal(payload.title,undefined);
    assert.equal(payload.text,undefined);
    assert.equal(JSON.parse(await payload.files[0].text()).number,'წინასწარი');
});

test('Summary invoice filenames follow the displayed people count and update after edits',async()=>{
    const ui=page();ui.context.activeInvoiceType='summary';
    ui.get('summaryQuantity').value='45 ადამიანი';await ui.prepare();
    ui.get('invoiceDownloadBtn').handlers.click();
    assert.equal(ui.downloads[0],'Invoice-45-People.pdf');
    ui.get('summaryQuantity').value='60 ადამიანი';ui.schedule();
    assert.equal(ui.get('invoiceDownloadBtn').disabled,true);
    await ui.advance(250);ui.get('invoiceDownloadBtn').handlers.click();
    assert.equal(ui.downloads[1],'Invoice-60-People.pdf');
    for(const quantity of ['','დასაზუსტებელია','30-40 ადამიანი','30.5 ადამიანი']) {
        ui.get('summaryQuantity').value=quantity;await ui.prepare();ui.get('invoiceDownloadBtn').handlers.click();
        assert.equal(ui.downloads.at(-1),'Invoice.pdf');
    }
});

test('Typing invalidates the old file immediately and prepares only the final burst after 250 ms',async()=>{
    const ui=page({supported:true});await ui.prepare();ui.preparations.length=0;
    for(const letter of 'AuditName') {
        ui.get('prevPayerName').textContent+=letter;ui.schedule();
        assert.equal(ui.get('invoiceDownloadBtn').disabled,true);
        assert.equal(ui.get('invoiceSharePdfBtn').disabled,true);
        ui.get('invoiceDownloadBtn').handlers.click();
        await ui.advance(40);
        assert.equal(ui.preparations.length,0);
    }
    assert.equal(ui.downloads.length,0);
    await ui.advance(209);assert.equal(ui.preparations.length,0);
    await ui.advance(1);assert.equal(ui.preparations.length,1);
    assert.equal(ui.preparations[0].payerName,'ტესტიAuditName');
    assert.equal(ui.get('invoiceDownloadBtn').disabled,false);
    ui.get('invoiceDownloadBtn').handlers.click();
    assert.equal(JSON.parse(await ui.built[0].text()).payerName,'ტესტიAuditName');
});

test('An edit while fonts load invalidates their earlier preparation until the debounce finishes',async()=>{
    let release;const gate=new Promise(resolve=>{release=resolve;});
    const ui=page({fetch:async()=>{await gate;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};}});
    const first=ui.prepare();
    ui.get('prevInvoiceNumber').textContent='LATEST';ui.schedule();
    release();await first;
    assert.equal(ui.preparations.length,0);
    assert.equal(ui.get('invoiceDownloadBtn').disabled,true);
    await ui.advance(250);
    assert.equal(ui.preparations.length,1);
    assert.equal(ui.preparations[0].number,'LATEST');
});

test('Closing cancels a pending timer and reopening prepares the latest type without duplicate listeners',async()=>{
    const ui=page();await ui.prepare();ui.preparations.length=0;
    ui.get('prevInvoiceNumber').textContent='CLOSED';ui.schedule();ui.cancel();
    await ui.advance(250);
    assert.equal(ui.preparations.length,0);
    assert.equal(ui.get('invoiceDownloadBtn').disabled,true);
    ui.get('prevInvoiceNumber').textContent='REOPENED';
    ui.get('prevInvoiceTable').tHead.rows[0].cells[0].textContent='Summary';
    await ui.prepare();
    assert.equal(ui.preparations.length,1);
    assert.equal(ui.preparations[0].number,'REOPENED');
    assert.equal(ui.preparations[0].head[0].text,'Summary');
    for(const id of ['invoiceDownloadBtn','invoiceSharePdfBtn','invoicePdfRetry'])assert.equal(ui.get(id).listenerCounts.click,1);
});

test('PDF libraries load on demand in order, retry only the failed library and survive closing during loading',async()=>{
    const ui=page({libraries:false});
    assert.equal(ui.scripts.length,0);
    const first=ui.prepare();
    assert.equal(ui.scripts.length,1);
    assert.match(ui.scripts[0].src,/jspdf\.umd\.min\.js\?v=/);
    await ui.finishScript(0);
    assert.equal(ui.scripts.length,2);
    assert.match(ui.scripts[1].src,/autotable/);
    await ui.finishScript(1,false);await first;
    assert.equal(ui.get('invoicePdfRetry').hidden,false);
    assert.equal(ui.get('invoiceDownloadBtn').disabled,true);
    const retry=ui.get('invoicePdfRetry').handlers.click();
    await ui.advance(0);
    assert.equal(ui.scripts.length,3);
    assert.match(ui.scripts[2].src,/autotable/);
    ui.cancel();await ui.finishScript(2);await retry;
    assert.equal(ui.preparations.length,0);
    assert.equal(ui.get('invoiceDownloadBtn').disabled,true);
    ui.get('prevInvoiceNumber').textContent='REOPENED';await ui.prepare();
    assert.equal(ui.scripts.length,3);
    assert.equal(ui.preparations.length,1);
    assert.equal(ui.preparations[0].number,'REOPENED');
});

test('Pause and resume typing starts a new preparation only after each full debounce',async()=>{
    const ui=page();await ui.prepare();ui.preparations.length=0;
    ui.get('prevInvoiceNumber').textContent='FIRST';ui.schedule();await ui.advance(250);
    assert.equal(ui.preparations.length,1);
    ui.get('prevInvoiceNumber').textContent='SECOND';ui.schedule();
    assert.equal(ui.get('invoiceDownloadBtn').disabled,true);
    await ui.advance(249);assert.equal(ui.preparations.length,1);
    await ui.advance(1);assert.equal(ui.preparations.length,2);
    assert.equal(ui.preparations[1].number,'SECOND');
});
