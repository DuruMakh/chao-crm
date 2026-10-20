const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function generator(fetch) {
    const elements=new Map(),requests=[];
    const get=id=>{
        if(!elements.has(id)) {
            const classes=new Set(),handlers={},listenerCounts={};
            elements.set(id,{value:'75',textContent:'',disabled:false,handlers,listenerCounts,
                classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},
                addEventListener(event,fn){handlers[event]=fn;listenerCounts[event]=(listenerCounts[event]||0)+1;},
                querySelector:selector=>get(id+selector)});
        }
        return elements.get(id);
    };
    let initialize;
    const document={getElementById:get,querySelectorAll:()=>[],addEventListener:(event,fn)=>{initialize=fn;}};
    const context=vm.createContext({document,AbortSignal:{timeout:ms=>({timeout:ms})},
        fetch:(url,options)=>{requests.push({url,options});return fetch(url,options);}});
    vm.runInContext(fs.readFileSync(require.resolve('../menu-generator.js'),'utf8'),context);
    return {get,requests,initialize:()=>initialize(),run:code=>vm.runInContext(code,context)};
}
const response=price=>({ok:true,text:async()=>`Name,Notes,Price\nDish,,${price}\n`});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('Generator catalog timeout can retry without reloading or losing guest input and listeners',async()=>{
    let calls=0;
    const ui=generator(async()=>{if(++calls===1)throw Object.assign(new Error('timeout'),{name:'TimeoutError'});return response(5);});
    await ui.initialize();
    assert.equal(ui.requests[0].options.signal.timeout,10000);
    assert.equal(ui.get('errorState').classList.contains('hidden'),false);
    assert.equal(ui.get('generateBtn').disabled,true);
    ui.get('guestInput').value='140';
    await ui.get('retryBtn').handlers.click();
    assert.equal(ui.get('guestInput').value,'140');
    assert.equal(ui.get('mainContent').classList.contains('hidden'),false);
    assert.equal(ui.get('errorState').classList.contains('hidden'),true);
    assert.equal(ui.get('generateBtn').disabled,false);
    assert.equal(ui.get('generateBtn').listenerCounts.click,1);
    assert.equal(ui.get('copyBtn').listenerCounts.click,1);
    assert.equal(ui.get('retryBtn').listenerCounts.click,1);
});

test('A superseded generator catalog response cannot replace the newest price data or loading state',async()=>{
    const first=deferred(),second=deferred();let calls=0;
    const ui=generator(()=>++calls===1?first.promise:second.promise);
    const oldLoad=ui.initialize(),newLoad=ui.get('retryBtn').handlers.click();
    second.resolve(response(8));await newLoad;
    first.resolve(response(5));await oldLoad;
    assert.equal(ui.run('getPrice("Dish")'),8);
    assert.equal(ui.get('generateBtn').disabled,false);
    assert.equal(ui.get('mainContent').classList.contains('hidden'),false);
});
