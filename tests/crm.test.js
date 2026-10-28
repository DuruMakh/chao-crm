const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../crm-model.js');
const context = vm.createContext({ CrmModel:model });
vm.runInContext(fs.readFileSync(require.resolve('../google-apps-script.js'),'utf8'),context);
const enquiry = () => ({id:'order-1',revision:0,name:'Test event',phone:'',eventDate:'',eventTime:'',location:'',guests:0,status:'enquiry',notes:'',serviceFee:0,transportFee:0,paid:0,pricing:'snapshot',items:[]});
const save = (order,orders=[],requestId='save-1') => context.prepareSave({action:'save',version:2,order,requestId},orders,'2026-10-19T12:00:00.000Z');

test('An enquiry needs either a client name or an event name, but no menu, date, or price',()=>{
    const result=save(enquiry()).order;
    assert.equal(result.total,0); assert.equal(result.revision,1); assert.equal(result.paid,0);
    assert.throws(()=>save({...enquiry(),name:' '}),{code:'VALIDATION'});
    const clientOnly=save({...enquiry(),name:'',clientName:'Nino'}).order;
    assert.equal(clientOnly.clientName,'Nino'); assert.equal(clientOnly.name,'');
});
test('Quote uses stored unit prices and rounds currency in cents',()=>{
    const result=save({...enquiry(),items:[{name:'Canape',qty:3,price:2.35}],serviceFee:30,transportFee:10}).order;
    assert.equal(result.total,47.05);
    const updated=save({...result,clientName:'Nino',companyName:'Example Ltd',companyCode:'001234567',email:'nino@example.com'},[result],'save-2').order;
    assert.equal(updated.total,47.05); assert.equal(updated.items[0].price,2.35);
    assert.equal(updated.name,'Test event'); assert.equal(updated.clientName,'Nino');
    const cleared=save({...updated,companyName:'',companyCode:'',email:''},[updated],'save-3').order;
    assert.equal(cleared.companyCode,''); assert.equal(cleared.email,''); assert.equal(cleared.total,47.05);
});
test('Payment supports deposits, full payment, overpayment and unknown',()=>{
    const order={...enquiry(),items:[{name:'Lunch',qty:2,price:50}]};
    for(const [paid,balance] of [[20,80],[100,0],[110,-10],[null,null]]) {
        assert.equal(model.balance(save({...order,paid}).order),balance);
    }
    assert.throws(()=>save({...order,paid:-1}),{code:'VALIDATION'});
});
test('A lost save response can be retried without a second revision or duplicate order',()=>{
    const draft=enquiry(),first=save(draft).order,retry=save(draft,[first]);
    assert.equal(retry.changed,false);assert.equal(retry.order.revision,1);
});
test('A stale editor cannot overwrite another saved change',()=>{
    const first=save(enquiry()).order;
    const second=save({...first,notes:'Other editor'},[first],'save-2').order;
    assert.throws(()=>save({...first,notes:'Stale editor'},[second],'save-3'),{code:'CONFLICT'});
});
test('An old browser version cannot overwrite the new contact fields',()=>{
    const current=save({...enquiry(),clientName:'Nino',email:'nino@example.com'}).order;
    assert.throws(()=>context.prepareSave({action:'save',requestId:'old-client',order:current},[current],'now'),{code:'UPDATE_REQUIRED'});
});
test('Legacy orders preserve IDs, totals and unknown payments/prices',()=>{
    const old=model.fromLegacy({id:'legacy',name:'Existing',total:543.21,date:'2026-05-01T00:00:00.000Z',quantitiesByName:{Canape:10,__serviceFee:30,__peopleCount:20}});
    const changed=save({...old,phone:'555',paid:100},[old]).order;
    assert.equal(changed.id,'legacy');assert.equal(changed.total,543.21);assert.equal(old.paid,null);assert.equal(changed.items[0].price,null);assert.equal(changed.eventDate,'');
    assert.throws(()=>save({...old,items:[]},[old]),{code:'REPRICE_REQUIRED'});
    const repriced=save({...old,pricing:'snapshot',items:[{name:'Canape',qty:10,price:4}]},[old]).order;
    assert.equal(repriced.total,70);
});
test('Invalid emails, dates, stages, duplicate menu lines and fractional guests are rejected',()=>{
    for(const change of [{email:'invalid address'},{email:'name@'},{eventDate:'2026-02-30'},{eventTime:'24:30'},{status:'invalid'},{guests:1.2},{items:[{name:'A',qty:1,price:1},{name:'A',qty:1,price:1}]}]) {
        assert.throws(()=>save({...enquiry(),...change}),{code:'VALIDATION'});
    }
});
test('Sheet round trip preserves separate names, company code zeros, email, and quote data',()=>{
    const order=save({...enquiry(),clientName:'Nino',companyName:'Example Ltd',companyCode:'001234567',email:'nino+events@example.com',phone:'0555',paid:null,items:[{name:'A',qty:3,price:2.5}]}).order;
    const read=model.fromRows([model.toRow(order)],[[order.id,'A',3,2.5,7.5]])[0];
    assert.deepEqual(read,order);
});
test('Existing sheet rows keep their event name and leave the new contact fields blank',()=>{
    const old=model.toRow(save(enquiry()).order).slice(0,18);
    const read=model.fromRows([old],[])[0];
    assert.equal(read.name,'Test event');
    for(const field of ['clientName','companyName','companyCode','email']) assert.equal(read[field],'');
});
test('Order and menu writes are issued in a single atomic batch, without deletion',()=>{
    let batches=[];
    context.Sheets={Spreadsheets:{get:()=>({sheets:[{properties:{sheetId:1},tables:[]},{properties:{sheetId:2},tables:[]}]}),batchUpdate:body=>batches.push(body)}};
    const sheet=id=>({getSheetId:()=>id,getMaxRows:()=>1000,getMaxColumns:()=>26,getLastRow:()=>10});
    context.writeCrm({orders:[save(enquiry()).order],ordersSheet:sheet(1),itemsSheet:sheet(2)});
    assert.equal(batches.length,1);assert.equal(batches[0].requests.filter(r=>r.updateCells).length,2);
    assert.equal(batches[0].requests.some(r=>r.deleteSheet||r.deleteDimension),false);
    assert.equal(batches[0].requests.filter(r=>r.updateCells)[1].updateCells.range.endRowIndex,10);
    assert.equal(batches[0].requests[0].updateCells.range.endColumnIndex,23);
});
test('Orders are listed with the latest event date first and undated enquiries last',()=>{
    const base={...enquiry(),updatedAt:''};
    const sorted=model.sortOrders([{...base,id:'undated'},{...base,id:'oct30',eventDate:'2026-10-30'},{...base,id:'nov1-early',eventDate:'2026-11-01',eventTime:'10:00'},{...base,id:'nov1-late',eventDate:'2026-11-01',eventTime:'18:00'},{...base,id:'done',status:'completed',eventDate:'2026-11-02'}]);
    assert.deepEqual(sorted.map(o=>o.id),['done','nov1-late','nov1-early','oct30','undated']);
});
test('Event dates are written as native sheet dates with an explicit date format',()=>{
    let batch;
    context.Sheets={Spreadsheets:{get:()=>({sheets:[{properties:{sheetId:1},tables:[]},{properties:{sheetId:2},tables:[]}]}),batchUpdate:body=>batch=body}};
    const sheet=id=>({getSheetId:()=>id,getMaxRows:()=>1000,getMaxColumns:()=>26,getLastRow:()=>2});
    const order=save({...enquiry(),eventDate:'2026-11-10',status:'confirmed'}).order;
    context.writeCrm({orders:[order],ordersSheet:sheet(1),itemsSheet:sheet(2)});
    const serial=batch.requests[0].updateCells.rows[1].values[3].userEnteredValue.numberValue;
    assert.equal(new Date((serial-25569)*86400000).toISOString().slice(0,10),'2026-11-10');
    assert.ok(batch.requests.some(r=>r.repeatCell?.cell.userEnteredFormat.numberFormat.pattern==='yyyy-mm-dd'));
    assert.equal(order.status,'confirmed');
});
