const {test}=require('node:test');
const assert=require('node:assert/strict');
const DateInput=require('../date-input.js');

test('Date entry always reads day before month, including ambiguous dates and pasted slashes',()=>{
    assert.equal(DateInput.parse('05.04.2026'),'2026-04-05');
    assert.equal(DateInput.parse('5/4/2026'),'2026-04-05');
    assert.equal(DateInput.format('2026-04-05'),'05.04.2026');
    assert.equal(DateInput.parse('29.02.2028'),'2028-02-29');
    assert.equal(DateInput.parse(''), '');
    assert.equal(DateInput.format(''), '');
});

test('Impossible or incomplete dates cannot silently become another date',()=>{
    for(const value of ['29.02.2026','31.04.2026','00.10.2026','23.13.2026','23.10.0000','23.10.','2026-10-23','10/23/2026']) {
        assert.equal(DateInput.parse(value),null,value);
    }
});
