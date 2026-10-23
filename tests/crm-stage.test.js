const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const CrmModel=require('../crm-model.js');
const DateInput=require('../date-input.js');

function order() {
    return {...CrmModel.fromLegacy({id:'stage-test',name:'Test event',total:100,quantitiesByName:{}}),
        revision:1,pricing:'snapshot',clientName:'Saved client',paid:20,status:'enquiry',items:[{name:'Lunch',qty:2,price:50}]};
}
async function page({initial=order(),save=async draft=>({...draft,revision:draft.revision+1}),draftSave=()=>{}}={}) {
    const elements=new Map(),requests=[],drafts=[];
    const get=id=>{
        if(!elements.has(id)) {
            const classes=new Set();
            const classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),
                toggle(c,on){if(on)classes.add(c);else classes.delete(c);}};
            elements.set(id,{id,name:id.startsWith('stage-')?'orderStage':'',value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,checked:false,style:{},classList,handlers:{},
                setCustomValidity(value){this.validationMessage=value;},addEventListener(name,fn){this.handlers[name]=fn;},insertAdjacentHTML(){},focus(){document.activeElement=this;},closest:()=>({classList})});
        }
        return elements.get(id);
    };
    const document={body:{},getElementById:get,createElement:()=>({textContent:'',get innerHTML(){return String(this.textContent).replaceAll('&','&amp;').replaceAll('<','&lt;');}})};
    let fieldsDisabled=false;
    Object.defineProperty(get('formFields'),'disabled',{get:()=>fieldsDisabled,set(value){
        fieldsDisabled=value;
        if(value && document.activeElement?.name==='orderStage') document.activeElement=document.body;
    }});
    const location={hash:'#order=stage-test'};
    let cached=[];
    const context=vm.createContext({DateInput,document,location,structuredClone,URLSearchParams,CrmModel,CRM_CONFIG:{spreadsheetUrl:''},
        window:{addEventListener(){},scrollTo(){}},history:{replaceState(a,b,url){location.hash=url;}},confirm:()=>true,
        CrmApi:{cachedOrders:()=>cached,cachedState:()=>({orders:cached,refreshedAt:null,available:!!cached.length}),
            list:async()=>{cached=[initial];return cached;},save:async draft=>{requests.push(structuredClone(draft));return save(draft);}},
        CrmDraft:{clear(){},save(draft){draftSave(draft);drafts.push(structuredClone(draft));}}});
    await vm.runInContext(fs.readFileSync(require.resolve('../crm.js'),'utf8'),context);
    const select=stage=>get('orderForm').handlers.input({target:{name:'orderStage',value:stage}});
    const edit=(id,value)=>{get(id).value=value;get('orderForm').handlers.input({target:{name:id,value}});};
    return {get,document,requests,drafts,select,edit,run:code=>vm.runInContext(code,context),submit:()=>get('orderForm').handlers.submit({preventDefault(){}})};
}

test('A stage selection saves immediately and uses the confirmed order, preserving unrelated unsaved fields',async()=>{
    const ui=await page();
    ui.edit('clientName','Unfinished client');ui.edit('paid','75');
    await ui.select('confirmed');
    assert.equal(ui.requests.length,1);
    assert.equal(ui.requests[0].status,'confirmed');
    assert.equal(ui.requests[0].clientName,'Saved client');
    assert.equal(ui.requests[0].paid,20);
    assert.equal(ui.get('clientName').value,'Unfinished client');assert.equal(ui.get('paid').value,'75');
    assert.equal(ui.run('activeOrder.revision'),2);assert.equal(ui.run('dirty'),true);
    assert.equal(ui.get('stageSaveState').textContent,'შენახულია');
    await ui.submit();
    assert.equal(ui.requests[1].revision,2);
    assert.equal(ui.requests[1].status,'confirmed');assert.equal(ui.requests[1].paid,'75');
    assert.equal(ui.requests[1].clientName,'Unfinished client');
});

test('Day-first dates survive saving and reopening, while invalid dates never reach storage',async()=>{
    const ui=await page({initial:{...order(),eventDate:'2026-04-05'}});
    assert.equal(ui.get('eventDate').value,'05.04.2026');
    ui.edit('eventDate','06.05.2026');
    await ui.submit();
    assert.equal(ui.requests[0].eventDate,'2026-05-06');
    assert.equal(ui.get('eventDate').value,'06.05.2026');
    ui.edit('eventDate','31.04.2026');
    await ui.submit();
    assert.equal(ui.requests.length,1);
    assert.equal(ui.get('eventDate').value,'31.04.2026');
    ui.edit('eventDate','');
    await ui.submit();
    assert.equal(ui.requests[1].eventDate,'');
});

test('Changing a new draft stage stores its day-first entry as the original ISO date',async()=>{
    const ui=await page({initial:{...order(),revision:0,eventDate:'2026-04-05'}});
    ui.edit('eventDate','06.05.2026');
    await ui.select('confirmed');
    assert.equal(ui.drafts[0].eventDate,'2026-05-06');
    assert.equal(ui.get('eventDate').value,'06.05.2026');
});

test('Paid sits between Confirmed and Completed, saves independently of payment amounts and can advance to Completed',async()=>{
    const ui=await page({initial:{...order(),status:'confirmed'}});
    assert.deepEqual(Array.from(ui.run('flowStages')),['enquiry','quoted','confirmed','paid','completed']);
    ui.edit('paid','75');
    await ui.select('paid');
    assert.equal(ui.requests[0].status,'paid');
    assert.equal(ui.requests[0].paid,20);
    assert.equal(ui.get('paid').value,'75');
    assert.equal(ui.get('stage-paid').checked,true);
    assert.equal(ui.get('stageCurrent').textContent,'გადახდილია');
    assert.equal(ui.get('stageProgress').style.width,'75%');
    await ui.select('completed');
    assert.equal(ui.requests[1].status,'completed');
    assert.equal(ui.requests[1].paid,20);
    assert.equal(ui.get('stageProgress').style.width,'100%');
    const reopened=await page({initial:{...order(),status:'paid'}});
    assert.equal(reopened.get('stage-paid').checked,true);
    assert.equal(reopened.get('stageCurrent').textContent,'გადახდილია');
});

test('An unchanged stage does not save; a pending stage save locks controls and cannot overlap another write',async()=>{
    let finish;
    const ui=await page({save:draft=>new Promise(resolve=>{finish=()=>resolve({...draft,revision:2});})});
    await ui.select('enquiry');assert.equal(ui.requests.length,0);
    const pending=ui.select('quoted');
    assert.equal(ui.get('formFields').disabled,true);assert.equal(ui.get('saveBtn').disabled,true);assert.equal(ui.get('deleteBtn').disabled,true);
    assert.equal(ui.get('stageSaveState').textContent,'ინახება…');assert.equal(ui.run('activeOrder.status'),'enquiry');
    await ui.select('completed');await ui.submit();assert.equal(ui.requests.length,1);
    finish();await pending;
    assert.equal(ui.get('formFields').disabled,false);assert.equal(ui.get('saveBtn').disabled,false);assert.equal(ui.get('deleteBtn').disabled,false);
    assert.equal(ui.run('activeOrder.status'),'quoted');assert.equal(ui.run('dirty'),false);
});

test('An unconfirmed stage save restores the last confirmed stage, keeps other edits and retries the same order',async()=>{
    let attempts=0;
    const ui=await page({save:async draft=>{if(++attempts===1)throw new Error('Response lost');return {...draft,revision:2};}});
    ui.edit('notes','Keep this note');
    await ui.select('completed');
    assert.equal(ui.get('status').value,'enquiry');assert.equal(ui.get('stage-enquiry').checked,true);
    assert.equal(ui.get('stage-completed').checked,false);assert.equal(ui.run('activeOrder.revision'),1);
    assert.equal(ui.get('notes').value,'Keep this note');assert.equal(ui.run('dirty'),true);
    assert.equal(ui.get('stageSaveState').textContent,'ვერ შეინახა');assert.equal(ui.get('notice').hidden,false);
    await ui.select('completed');
    assert.deepEqual(ui.requests[0],ui.requests[1]);
    assert.equal(ui.get('status').value,'completed');assert.equal(ui.get('notes').value,'Keep this note');
    assert.equal(ui.get('stageSaveState').classList.contains('error'),false);
});

test('A new order keeps the selected stage in its draft without prematurely creating a Google order',async()=>{
    const ui=await page({initial:{...order(),revision:0}});
    ui.edit('clientName','Draft client');
    await ui.select('quoted');
    assert.equal(ui.requests.length,0);assert.equal(ui.drafts.length,1);
    assert.equal(ui.drafts[0].status,'quoted');assert.equal(ui.drafts[0].clientName,'Draft client');
    assert.equal(ui.run('activeOrder.revision'),0);assert.equal(ui.run('dirty'),true);
    assert.equal(ui.get('stageSaveState').textContent,'მონახაზში შენახულია');
});

test('A draft storage failure keeps the prior stage and edited fields available',async()=>{
    const ui=await page({initial:{...order(),revision:0},draftSave(){throw new Error('Storage full');}});
    ui.edit('clientName','Draft client');await ui.select('cancelled');
    assert.equal(ui.get('status').value,'enquiry');assert.equal(ui.get('clientName').value,'Draft client');
    assert.equal(ui.requests.length,0);assert.equal(ui.get('formFields').disabled,false);
    assert.equal(ui.get('stageSaveState').textContent,'ვერ შეინახა');
});

test('Keyboard focus returns to the selected stage after success, failure or a draft save',async()=>{
    for(const [options,selected] of [
        [{},'quoted'],
        [{save:async()=>{throw new Error('Offline');}},'enquiry'],
        [{initial:{...order(),revision:0}},'quoted'],
    ]) {
        const ui=await page(options);
        ui.get('stage-quoted').focus();
        await ui.select('quoted');
        assert.equal(ui.document.activeElement,ui.get('stage-'+selected));
        assert.equal(ui.document.activeElement.checked,true);
    }
});

test('A completed stage save does not steal focus when the user moves elsewhere',async()=>{
    let finish;
    const ui=await page({save:draft=>new Promise(resolve=>{finish=()=>resolve({...draft,revision:2});})});
    ui.get('stage-quoted').focus();
    const pending=ui.select('quoted');
    assert.equal(ui.document.activeElement,ui.document.body);
    ui.get('detailBack').focus();
    finish();await pending;
    assert.equal(ui.document.activeElement,ui.get('detailBack'));
});
