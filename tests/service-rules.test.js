const {test}=require('node:test');
const assert=require('node:assert/strict');
const ServiceRules=require('../service-rules.js');

test('Boxes hold 15 pieces each',()=>{
    assert.equal(ServiceRules.boxesFor(0),0);
    assert.equal(ServiceRules.boxesFor(15),1);
    assert.equal(ServiceRules.boxesFor(16),2);
});

test('Each service option follows the published price rules',()=>{
    assert.deepEqual(ServiceRules.fees('pickup',{guests:30,boxes:4}),{serviceFee:20,transportFee:0});
    assert.deepEqual(ServiceRules.fees('boxes',{guests:30,boxes:4}),{serviceFee:20,transportFee:25});
    assert.deepEqual(ServiceRules.fees('setup',{guests:30,boxes:4}),{serviceFee:150,transportFee:60});
    assert.deepEqual(ServiceRules.fees('setup',{guests:10,boxes:0}),{serviceFee:50,transportFee:25});
    assert.deepEqual(ServiceRules.fees('full',{guests:30,boxes:4}),{serviceFee:300,transportFee:60});
});
