const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('../crm-model.js');

const order=id=>({id,name:`Event ${id}`,clientName:'Client',companyName:'Company',companyCode:'001234',email:'client@example.test',
    phone:'0555123456',eventDate:'2026-11-10',eventTime:'18:30',location:'Venue',guests:10,status:'enquiry',notes:'Private notes',
    serviceFee:10,transportFee:5,total:115,paid:null,pricing:'snapshot',items:[{name:'Menu',qty:2,price:50}],
    revision:1,lastRequestId:'previous-save',createdAt:'2026-10-19T10:00:00.000Z',updatedAt:'2026-10-19T10:00:00.000Z'});

function backend(records,{orderRows=records.map(model.toRow),failWrite=false,busy=false}={}) {
    const normalize=(row,width)=>Array.from({length:width},(_,i)=>row[i]??'');
    let values=new Map([
        [1,[model.orderHeaders,...orderRows].map((row,index)=>{
            const cells=normalize(row,22);
            if(index&&cells[3])cells[3]=new Date(cells[3]);
            return cells;
        })],
        [2,[model.itemHeaders,...records.flatMap(record=>record.items.map(item=>
            [record.id,item.name,item.qty,item.price??'','=ROUND(C2*D2,2)']))]],
    ]);
    let locked=false,metadataReads=0;
    const batches=[],logs=[],dateReads=[];
    const lastRow=id=>{
        const rows=values.get(id);
        let count=rows.length;
        while(count>1&&!rows[count-1].some(value=>value!==''))count--;
        return count;
    };
    const sheet=id=>({getSheetId:()=>id,getMaxRows:()=>1000,getLastRow:()=>lastRow(id),
        getDataRange:()=>({getValues:()=>structuredClone(values.get(id).slice(0,lastRow(id)))})});
    const context=vm.createContext({CrmModel:model,Date,
        console:{log:message=>logs.push(JSON.parse(message))},
        SpreadsheetApp:{openById:()=>({getSheetByName:name=>sheet(name==='Orders'?1:2),getSpreadsheetTimeZone:()=>'Asia/Tbilisi'})},
        Utilities:{formatDate(date,timezone,format){dateReads.push({timezone,format});return format==='yyyy-MM-dd'?date.toISOString().slice(0,10):date.toISOString().slice(11,16);}},
        ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
        LockService:{getScriptLock:()=>({tryLock:()=>{locked=!busy;return locked;},hasLock:()=>locked,releaseLock:()=>{locked=false;}})},
        Sheets:{Spreadsheets:{
            get:()=>{metadataReads++;return {sheets:[1,2].map(id=>({properties:{sheetId:id},tables:[{tableId:String(id)}]}))};},
            batchUpdate:body=>{
                assert.equal(locked,true,'Writes must remain inside the script lock');
                const batch=JSON.parse(JSON.stringify(body));batches.push(batch);
                if(failWrite)throw new Error('Google write failed');
                const next=structuredClone(values);
                for(const {updateCells:write} of batch.requests) {
                    if(!write)continue;
                    const rows=next.get(write.range.sheetId),width=write.range.sheetId===1?22:5;
                    for(let r=write.range.startRowIndex;r<write.range.endRowIndex;r++) {
                        if(!rows[r])rows[r]=Array(width).fill('');
                        for(let c=write.range.startColumnIndex;c<write.range.endColumnIndex;c++) {
                            const cell=write.rows[r-write.range.startRowIndex]?.values[c-write.range.startColumnIndex]?.userEnteredValue;
                            let value=cell?.numberValue??cell?.stringValue??cell?.formulaValue??'';
                            if(write.range.sheetId===1&&r>0&&c===3&&typeof value==='number')value=new Date((value-25569)*86400000);
                            rows[r][c]=value;
                        }
                    }
                }
                values=next;
            },
        }},
    });
    vm.runInContext(fs.readFileSync(require.resolve('../google-apps-script.js'),'utf8'),context);
    return {batches,logs,dateReads,list:()=>context.doGet(),snapshot:()=>structuredClone(values),locked:()=>locked,
        get metadataReads(){return metadataReads;},set failWrite(value){failWrite=value;},
        save:(record,requestId='next-save')=>context.doPost({postData:{contents:JSON.stringify({action:'save',version:2,order:record,requestId})}}),
        remove:record=>context.doPost({postData:{contents:JSON.stringify({action:'delete',version:2,orderId:record.id,revision:record.revision})}})};
}

function oneRowWrite(server,rowIndex) {
    const requests=server.batches.at(-1).requests;
    assert.equal(requests.length,1);
    assert.deepEqual(requests[0].updateCells.range,{sheetId:1,startRowIndex:rowIndex,endRowIndex:rowIndex+1,startColumnIndex:0,endColumnIndex:22});
    assert.equal(requests[0].updateCells.fields,'userEnteredValue');
    assert.equal(requests[0].updateCells.rows.length,1);
    assert.equal(server.metadataReads,0);
    return requests[0].updateCells.rows[0].values;
}

test('A stage save writes one order row and no menu rows in the 17-order, 231-item fixture',()=>{
    const records=Array.from({length:17},(_,index)=>{
        const record=order(`record-${index}`);
        record.items=Array.from({length:index<10?14:13},(_,item)=>({name:`Product ${item}`,qty:1,price:2}));
        record.total=model.total(record);
        return record;
    });
    const server=backend(records),before=server.snapshot();
    const response=server.save({...records[8],status:'confirmed'});
    assert.equal(response.success,true);assert.equal(response.order.revision,2);
    oneRowWrite(server,9);
    const after=server.snapshot();
    assert.deepEqual(after.get(2),before.get(2));
    for(let row=0;row<before.get(1).length;row++)if(row!==9)assert.deepEqual(after.get(1)[row],before.get(1)[row]);
    assert.deepEqual(server.list().orders.find(record=>record.id===records[8].id),response.order);
    const timing=server.logs[0];
    assert.equal(timing.path,'row');assert.equal(timing.orderRowsWritten,1);assert.equal(timing.itemRowsWritten,0);
    assert.equal(timing.batchWrites,1);assert.equal(timing.batchRequests,1);assert.equal(timing.metadataReads,0);
    assert.equal(timing.orderRowsRead,18);assert.equal(timing.itemRowsRead,232);
});

test('The fast path uses the physical order row despite blank gaps and different row order',()=>{
    const records=[order('first'),order('target'),order('last')];
    const rows=[model.toRow(records[2]),[],model.toRow(records[1]),[],model.toRow(records[0])];
    const server=backend(records,{orderRows:rows}),before=server.snapshot();
    const response=server.save({...records[1],clientName:'Edited client'});
    assert.equal(response.success,true);
    oneRowWrite(server,3);
    const after=server.snapshot();
    for(const row of [0,1,2,4,5])assert.deepEqual(after.get(1)[row],before.get(1)[row]);
    assert.equal(after.get(1)[3][18],'Edited client');
    assert.deepEqual(after.get(2),before.get(2));
});

test('Single-row writes preserve native event dates, text company codes and unknown versus zero payments',()=>{
    for(const paid of [null,0,15]) {
        const saved=order('typed-fields'),server=backend([saved]);
        const response=server.save({...saved,paid,companyCode:'000987',phone:'00123',eventDate:'2026-12-03'});
        assert.equal(response.success,true);
        const cells=oneRowWrite(server,1);
        assert.equal(cells[3].userEnteredValue.numberValue,Date.parse('2026-12-03')/86400000+25569);
        assert.deepEqual(cells[20],{userEnteredValue:{stringValue:'000987'}});
        assert.deepEqual(cells[2],{userEnteredValue:{stringValue:'00123'}});
        assert.deepEqual(cells[12],paid===null?{}:{userEnteredValue:{numberValue:paid}});
        const reloaded=server.list().orders[0];
        assert.equal(reloaded.eventDate,'2026-12-03');assert.equal(reloaded.paid,paid);assert.equal(reloaded.companyCode,'000987');
        assert.ok(server.dateReads.every(read=>read.timezone==='Asia/Tbilisi'&&read.format==='yyyy-MM-dd'));
    }
});

test('Legacy stage, payment and contact changes retain exact unknown menu prices and historical total',()=>{
    const saved={...order('legacy'),pricing:'legacy',total:543.21,items:[{name:'Old dish',qty:12,price:null},{name:'Included',qty:2,price:0}]};
    for(const change of [{status:'completed'},{paid:0},{paid:100},{clientName:'New contact',companyCode:'00004'}]) {
        const server=backend([saved]),before=server.snapshot();
        const response=server.save({...saved,...change});
        assert.equal(response.success,true);oneRowWrite(server,1);
        assert.equal(response.order.total,543.21);assert.deepEqual(response.order.items,saved.items);
        assert.deepEqual(server.snapshot().get(2),before.get(2));
        assert.deepEqual(server.list().orders[0],response.order);
    }
});

test('Menu, fee, pricing and quote changes retain the full atomic write path',()=>{
    const scenarios=[
        {change:{serviceFee:11}},
        {change:{transportFee:6}},
        {change:{items:[{name:'Menu',qty:3,price:50}]}},
        {change:{items:[{name:'Menu',qty:2,price:51}]}},
        {change:{items:[{name:'Renamed',qty:2,price:50}]}},
        {change:{items:[]}},
        {stored:{total:999},change:{status:'confirmed'}},
        {stored:{pricing:'legacy',total:543.21,items:[{name:'Menu',qty:2,price:null}]},
            change:{pricing:'snapshot',items:[{name:'Menu',qty:2,price:0}]}},
    ];
    for(const {stored,change} of scenarios) {
        const saved={...order('fallback'),...stored},neighbor=order('neighbor'),server=backend([saved,neighbor]);
        const response=server.save({...saved,...change});
        assert.equal(response.success,true,JSON.stringify(change));
        const writes=server.batches[0].requests.filter(request=>request.updateCells);
        assert.equal(writes.length,2);assert.equal(server.metadataReads,1);assert.equal(server.logs[0].path,'full');
        assert.deepEqual(server.list().orders.find(record=>record.id===saved.id),response.order);
        assert.deepEqual(server.list().orders.find(record=>record.id===neighbor.id),neighbor);
    }
});

test('New orders and deletions still write both tabs atomically',()=>{
    const saved=order('existing'),server=backend([saved]),draft={...order('new-order'),revision:0};
    const created=server.save(draft);
    assert.equal(created.success,true);
    assert.equal(server.batches[0].requests.filter(request=>request.updateCells).length,2);
    assert.equal(server.logs[0].path,'full');
    assert.equal(server.remove(created.order).success,true);
    assert.equal(server.batches[1].requests.filter(request=>request.updateCells).length,2);
    assert.equal(server.logs[1].operation,'delete');assert.equal(server.logs[1].path,'full');
    assert.deepEqual(server.list().orders,[saved]);
});

test('A failed menu-change batch changes neither tab and succeeds as a complete write on retry',()=>{
    const saved=order('menu-failure'),server=backend([saved,order('neighbor')],{failWrite:true}),before=server.snapshot();
    const draft={...saved,items:[{name:'Changed menu',qty:5,price:12}]};
    assert.equal(server.save(draft).success,false);
    assert.equal(server.batches[0].requests.filter(request=>request.updateCells).length,2);
    assert.deepEqual(server.snapshot(),before);assert.equal(server.locked(),false);
    server.failWrite=false;
    const response=server.save(draft);
    assert.equal(response.success,true);assert.equal(response.order.total,75);assert.equal(response.order.revision,2);
    assert.deepEqual(server.list().orders.find(record=>record.id===saved.id),response.order);
    assert.equal(server.snapshot().get(2)[1][1],'Changed menu');
});

test('Failed row writes leave persisted data unchanged; retries are applied once and stale editors are rejected',()=>{
    const saved=order('retry'),server=backend([saved],{failWrite:true}),before=server.snapshot();
    const draft={...saved,status:'confirmed'};
    const failure=server.save(draft,'same-request');
    assert.equal(failure.success,false);assert.equal(failure.error.code,'SERVER');assert.equal(server.locked(),false);
    assert.deepEqual(server.snapshot(),before);assert.equal(server.logs[0].outcome,'error');
    server.failWrite=false;
    const confirmed=server.save(draft,'same-request');
    assert.equal(confirmed.success,true);assert.equal(confirmed.order.revision,2);
    const after=server.snapshot();
    const retry=server.save(draft,'same-request');
    assert.deepEqual(retry,confirmed);assert.equal(server.batches.length,2);assert.deepEqual(server.snapshot(),after);
    assert.equal(server.logs[2].batchWrites,0);assert.equal(server.logs[2].path,'none');
    const stale=server.save({...saved,paid:25},'different-request');
    assert.equal(stale.success,false);assert.equal(stale.error.code,'CONFLICT');
    assert.equal(server.batches.length,2);assert.deepEqual(server.snapshot(),after);assert.equal(server.locked(),false);
});

test('Validation errors and an unavailable lock never issue writes',()=>{
    const saved=order('blocked'),invalid=backend([saved]),busy=backend([saved],{busy:true}),duplicate=backend([saved,saved]);
    assert.equal(invalid.save({...saved,paid:-1}).error.code,'VALIDATION');
    assert.equal(invalid.batches.length,0);assert.equal(invalid.locked(),false);
    assert.equal(busy.save({...saved,status:'confirmed'}).error.code,'BUSY');
    assert.equal(busy.batches.length,0);assert.equal(busy.locked(),false);
    assert.equal(busy.logs[0].sheetReads,0);assert.equal(busy.logs[0].outcome,'error');
    assert.equal(duplicate.save({...saved,status:'confirmed'}).error.code,'DUPLICATE_ID');
    assert.equal(duplicate.batches.length,0);assert.equal(duplicate.locked(),false);
});

test('Performance diagnostics record phase durations and counts without customer or order details',()=>{
    const saved=order('PRIVATE-ORDER-ID'),server=backend([saved]);
    assert.equal(server.list().success,true);
    assert.equal(server.save({...saved,clientName:'PRIVATE-CUSTOMER'},'PRIVATE-REQUEST-ID').success,true);
    assert.equal(server.logs.length,2);
    assert.equal(server.logs[0].operation,'list');assert.equal(server.logs[0].sheetReads,2);assert.equal(server.logs[0].batchWrites,0);
    assert.equal(server.logs[1].operation,'save');assert.equal(server.logs[1].outcome,'success');
    for(const entry of server.logs) {
        assert.equal(entry.event,'crm_performance');
        for(const field of ['lockWaitMs','readMs','buildMs','metadataMs','writeMs','responseMs','totalMs']) {
            assert.equal(typeof entry[field],'number',field);assert.ok(entry[field]>=0,field);
        }
    }
    const output=JSON.stringify(server.logs);
    for(const privateValue of [saved.id,saved.email,saved.phone,saved.notes,saved.companyCode,'PRIVATE-CUSTOMER','PRIVATE-REQUEST-ID'])assert.ok(!output.includes(privateValue));
});
