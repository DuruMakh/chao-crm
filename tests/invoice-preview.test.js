const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const CrmModel=require('../crm-model.js');

function calculator(order) {
    const elements=new Map();
    const get=id=>{
        if(!elements.has(id)) {
            const classes=new Set();
            elements.set(id,{value:'',textContent:'',innerHTML:'',style:{},disabled:false,attributes:{},
                classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),
                    toggle(c,on){if(on)classes.add(c);else classes.delete(c);}},
                addEventListener(){},setAttribute(k,v){this.attributes[k]=String(v);}});
        }
        return elements.get(id);
    };
    const document={getElementById:get,querySelectorAll:()=>[],addEventListener(){},
        createElement:()=>({textContent:'',get innerHTML(){return this.textContent.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}})};
    const context=vm.createContext({document,window:{addEventListener(){}},CrmModel,InvoiceFiles:{prepare(){},schedule(){},cancel(){}},order});
    for(const file of ['app.js','calculator-orders.js']) vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),context);
    vm.runInContext(`activeCrmOrder=order; calculatorCatalogReady=true; serviceFee=order.serviceFee; transportFee=order.transportFee; peopleCount=order.guests;
        products=order.items.map((item,index)=>({...item,index,price:item.price??999}));
        quantities=Object.fromEntries(order.items.map((item,index)=>[index,item.qty]));`,context);
    return {get,run:code=>vm.runInContext(code,context)};
}

test('Legacy detailed invoices show saved quantities and preserve the original total without repricing',()=>{
    const ui=calculator({id:'legacy',revision:1,pricing:'legacy',total:543.21,serviceFee:30,transportFee:10,guests:20,
        items:[{name:'კანაპე',qty:30,price:null}]});
    ui.run('updateButtonsState(); openInvoiceModal();');
    assert.equal(ui.get('invoiceTypeDetailed').disabled,false);
    assert.equal(ui.get('invoiceTypeDetailed').attributes['aria-pressed'],'true');
    const table=ui.get('prevInvoiceTable').innerHTML;
    assert.match(table,/კანაპე/);assert.match(table,/>30<\/td>/);
    for(const total of ['503.21','30.00','10.00','543.21']) assert.ok(table.includes('₾ '+total));
    assert.equal(ui.run('repriced'),false);
    assert.equal(ui.run('activeCrmOrder.items[0].price'),null);
    assert.equal(ui.get('saveOrderBtn').disabled,true);
    ui.run("switchInvoiceType('summary');");
    assert.match(ui.get('prevInvoiceTable').innerHTML,/ფურშეტი/);
    assert.match(ui.get('prevInvoiceTable').innerHTML,/543\.21/);
});

test('Detailed is the default each time; Summary is explicitly selectable for priced orders',()=>{
    const ui=calculator({id:'priced',revision:1,pricing:'snapshot',serviceFee:20,transportFee:10,guests:30,
        items:[{name:'დესერტი',qty:30,price:5}]});
    ui.run('openInvoiceModal();');
    assert.match(ui.get('prevInvoiceTable').innerHTML,/დესერტი/);
    assert.match(ui.get('prevInvoiceTable').innerHTML,/180\.00/);
    assert.equal(ui.get('summaryControls').style.display,'none');
    ui.run("switchInvoiceType('summary');");
    assert.equal(ui.get('invoiceTypeSummary').attributes['aria-pressed'],'true');
    assert.equal(ui.get('summaryControls').style.display,'');
    assert.match(ui.get('prevInvoiceTable').innerHTML,/ფურშეტი/);
    ui.run('closeInvoiceModal(); openInvoiceModal();');
    assert.equal(ui.get('invoiceTypeDetailed').attributes['aria-pressed'],'true');
    assert.match(ui.get('prevInvoiceTable').innerHTML,/დესერტი/);
});

test('Invoices open as preliminary, keep manual numbers editable and never use the order ID',()=>{
    const ui=calculator({id:'internal-order-123',revision:1,pricing:'snapshot',serviceFee:0,transportFee:0,guests:10,
        items:[{name:'კანაპე',qty:10,price:5}]});
    ui.run('openInvoiceModal();');
    assert.equal(ui.get('invoiceNumber').value,'წინასწარი');
    assert.equal(ui.get('prevInvoiceNumber').textContent,'წინასწარი');
    ui.get('invoiceNumber').value='INV-2026-01';ui.run('updateInvoicePreview();');
    assert.equal(ui.get('prevInvoiceNumber').textContent,'INV-2026-01');
    ui.get('invoiceNumber').value='';ui.run('updateInvoicePreview();');
    assert.equal(ui.get('prevInvoiceNumber').textContent,'წინასწარი');
    ui.run('closeInvoiceModal(); openInvoiceModal();');
    assert.equal(ui.get('invoiceNumber').value,'წინასწარი');
});
