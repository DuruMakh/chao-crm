const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('../crm-model.js');

const order=(id,items=[])=>({...model.fromLegacy({id,name:id,total:100,quantitiesByName:{}}),revision:2,items});
function backend(records,failWrite=false) {
    let locked=false;
    const batches=[];
    const sheet=(id,rows)=>({getSheetId:()=>id,getMaxRows:()=>1000,getLastRow:()=>rows});
    const state={orders:structuredClone(records),ordersSheet:sheet(1,records.length+1),itemsSheet:sheet(2,records.flatMap(o=>o.items).length+1)};
    const context=vm.createContext({CrmModel:model,
        LockService:{getScriptLock:()=>({tryLock:()=>{locked=true;return true;},hasLock:()=>locked,releaseLock:()=>{locked=false;}})},
        Sheets:{Spreadsheets:{get:()=>({sheets:[1,2].map(id=>({properties:{sheetId:id},tables:[{tableId:String(id)}]}))}),batchUpdate:body=>{batches.push(body);if(failWrite)throw new Error('Google write failed');}}}
    });
    vm.runInContext(fs.readFileSync(require.resolve('../google-apps-script.js'),'utf8'),context);
    context.readCrm=()=>state;
    context.jsonResponse=value=>JSON.parse(JSON.stringify(value));
    const remove=(id,revision=2)=>context.doPost({postData:{contents:JSON.stringify({action:'delete',version:2,orderId:id,revision})}});
    return {context,state,batches,remove,locked:()=>locked};
}

test('Deleting an order removes its menu lines in one batch and preserves neighboring orders',()=>{
    const item=name=>({name,qty:2,price:5});
    const records=[order('keep-before',[item('A')]),order('delete',[item('B'),item('C')]),order('keep-after',[item('D')])];
    const server=backend(records);
    assert.deepEqual(server.remove('delete'),{success:true,version:2,deletedId:'delete'});
    assert.equal(server.batches.length,1);
    const writes=server.batches[0].requests.filter(r=>r.updateCells).map(r=>r.updateCells);
    assert.deepEqual(Array.from(writes[0].rows.slice(1),r=>r.values[0].userEnteredValue.stringValue),['keep-before','keep-after']);
    assert.deepEqual(Array.from(writes[1].rows.slice(1),r=>r.values[0].userEnteredValue.stringValue),['keep-before','keep-after']);
    assert.equal(writes[0].range.endRowIndex,4); assert.equal(writes[0].rows.length,3);
    assert.equal(writes[1].range.endRowIndex,5); assert.equal(writes[1].rows.length,3);
    assert.deepEqual(server.state.orders,[records[0],records[2]]);
    assert.equal(server.locked(),false);
    assert.equal(server.remove('delete').success,true);
    assert.equal(server.batches.length,1,'Retry after a lost response does not write again');
    assert.throws(()=>server.context.prepareSave({action:'save',version:2,requestId:'stale-editor',order:records[1]},server.state.orders,'now'),{code:'CONFLICT'});
});

test('Stale and invalid delete requests never write to either sheet',()=>{
    const server=backend([order('keep')]);
    assert.equal(server.remove('keep',1).error.code,'CONFLICT');
    for(const [id,revision] of [['',2],['keep',0],['keep',1.5]]) assert.equal(server.remove(id,revision).error.code,'VALIDATION');
    assert.equal(server.batches.length,0); assert.equal(server.state.orders.length,1); assert.equal(server.locked(),false);
});

test('Deleting the last order clears old values while retaining headers and usable table ranges',()=>{
    const server=backend([order('last',[{name:'Menu',qty:1,price:10}])]);
    assert.equal(server.remove('last').success,true);
    const requests=server.batches[0].requests;
    for(const write of requests.filter(r=>r.updateCells).map(r=>r.updateCells)) {
        assert.equal(write.rows.length,1); assert.equal(write.range.endRowIndex,2);
        assert.equal(write.rows[0].values[0].userEnteredValue.stringValue,'Order ID');
    }
    for(const update of requests.filter(r=>r.updateTable)) assert.equal(update.updateTable.table.range.endRowIndex,2);
    assert.equal(server.state.orders.length,0);
});

test('A Google write failure returns an error and releases the order lock',()=>{
    const server=backend([order('delete')],true);
    const response=server.remove('delete');
    assert.equal(response.success,false); assert.equal(response.error.code,'SERVER');
    assert.equal(server.batches.length,1); assert.equal(server.locked(),false);
});
