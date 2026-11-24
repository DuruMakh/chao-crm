const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('../crm-model.js');

const catalog=[['Name','Notes','Price'],['კანაპეები','',''],['კანაპე','','3.5'],['დესერტი','','5,00']];
const reply=(result,extra={})=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({stop_reason:'end_turn',content:[{type:'thinking',thinking:''},{type:'text',text:JSON.stringify(result)}],...extra})});
const complete=(over={})=>({name:'დაბადების დღე',clientName:'ნინო',companyName:'',companyCode:'',phone:'555 12 34 56',email:'',eventDate:'2026-12-25',eventTime:'18:00',location:'ბათუმი',guests:30,notes:'',items:[{name:'კანაპე',qty:60}],unmatchedItems:[],...over});

function backend({key='secret-key',fetch=()=>reply(complete()),props={}}={}) {
    const properties={ANTHROPIC_API_KEY:key,...props},calls=[],logs=[];let locks=0;
    const context=vm.createContext({CrmModel:model,Date,Map,console:{log:()=>{},error:message=>logs.push(message)},
        PropertiesService:{getScriptProperties:()=>({getProperty:name=>properties[name]??null,setProperty:(name,value)=>{properties[name]=value;}})},
        SpreadsheetApp:{openById:id=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>{calls.push({catalog:id});return catalog;}})})})},
        Utilities:{formatDate:(date,zone,format)=>'2026-11-24'},
        UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});return fetch(url,options);}},
        ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
        LockService:{getScriptLock:()=>({tryLock:()=>{locks++;return true;},hasLock:()=>false,releaseLock:()=>{}})}});
    vm.runInContext(fs.readFileSync(require.resolve('../google-apps-script.js'),'utf8'),context);
    return {post:data=>context.doPost({postData:{contents:JSON.stringify({version:2,action:'parse',...data})}}),calls,logs,properties,locks:()=>locks};
}

test('Free text becomes an order draft, sent to Sonnet 5.5 at medium effort with the key kept on the server',()=>{
    const app=backend(),result=app.post({text:'ნინო, 25 დეკემბერს, 60 კანაპე'});
    assert.equal(result.success,true);
    const request=app.calls.find(call=>call.url);
    assert.equal(request.url,'https://api.anthropic.com/v1/messages');
    assert.equal(request.options.headers['x-api-key'],'secret-key');
    const body=JSON.parse(request.options.payload);
    assert.equal(body.model,'claude-sonnet-5-5');
    assert.equal(body.output_config.effort,'medium');
    assert.equal(body.output_config.format.type,'json_schema');
    assert.equal(body.output_config.format.schema.additionalProperties,false);
    assert.equal(body.tool_choice,undefined);
    assert.match(body.messages[0].content,/Today is 2026-11-24/);
    assert.match(body.messages[0].content,/60 კანაპე/);
    assert.deepEqual(result.parsed.items,[{name:'კანაპე',qty:60,price:3.5}]);
    assert.equal(result.parsed.eventDate,'2026-12-25');
    assert.equal(result.parsed.guests,30);
    assert.equal(app.locks(),0,'The AI call must not hold the sheet lock');
});

test('Prices come from the price list; unknown products, bad dates and bad quantities never reach the draft',()=>{
    const app=backend({fetch:()=>reply(complete({eventDate:'2026-02-31',eventTime:'25:00',guests:-4,notes:'ალერგია',
        items:[{name:'დესერტი',qty:10},{name:'დესერტი',qty:5},{name:'სუში',qty:20},{name:'კანაპე',qty:0}],unmatchedItems:['ხაჭაპური']}))});
    const {parsed}=app.post({text:'x'});
    assert.deepEqual(parsed.items,[{name:'დესერტი',qty:15,price:5}]);
    assert.deepEqual(parsed.unmatched,['ხაჭაპური','სუში','კანაპე']);
    assert.equal(parsed.notes,'ალერგია\nმენიუში ვერ მოიძებნა: ხაჭაპური, სუში, კანაპე');
    assert.equal(parsed.eventDate,'');assert.equal(parsed.eventTime,'');assert.equal(parsed.guests,0);
    assert.equal(model.total({items:parsed.items,serviceFee:0,transportFee:0}),75);
});

test('Missing key, empty or oversized text and the daily limit are refused before any AI call',()=>{
    let app=backend({key:null});
    assert.equal(app.post({text:'x'}).error.code,'AI_SETUP');
    app=backend();
    assert.equal(app.post({text:'  '}).error.code,'VALIDATION');
    assert.equal(app.post({text:'x'.repeat(4001)}).error.code,'VALIDATION');
    assert.equal(app.calls.filter(call=>call.url).length,0);
    app=backend({props:{AI_USAGE:'2026-11-24:100'}});
    assert.equal(app.post({text:'x'}).error.code,'AI_LIMIT');
    assert.equal(app.calls.filter(call=>call.url).length,0);
    app=backend({props:{AI_USAGE:'2026-11-23:100'}});
    assert.equal(app.post({text:'x'}).success,true);
    assert.equal(app.properties.AI_USAGE,'2026-11-24:1');
});

test('Failed, refused or malformed AI replies give a plain message and log no customer text or key',()=>{
    for(const fetch of [
        ()=>({getResponseCode:()=>529,getContentText:()=>JSON.stringify({error:{type:'overloaded_error'}})}),
        ()=>reply({},{stop_reason:'refusal'}),
        ()=>({getResponseCode:()=>200,getContentText:()=>'not json'}),
        ()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:'{broken'}]})}),
    ]) {
        const app=backend({fetch}),result=app.post({text:'საიდუმლო კლიენტი'});
        assert.equal(result.error.code,'AI_FAILED');
        assert.equal(app.logs.length,1);
        assert.doesNotMatch(app.logs[0],/საიდუმლო|secret-key/);
    }
});

test('The browser sends only the text to the Google service and returns the parsed order',async()=>{
    const requests=[],context=vm.createContext({window:{CRM_CONFIG:{apiUrl:'https://example.test/exec'}},localStorage:{getItem:()=>null,setItem:()=>{}},crypto:{randomUUID:()=>'id'},AbortSignal,
        fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({success:true,version:2,parsed:{name:'x'}})};}});
    vm.runInContext(fs.readFileSync(require.resolve('../crm-api.js'),'utf8'),context);
    assert.deepEqual(await context.window.CrmApi.parseText('ტექსტი'),{name:'x'});
    assert.deepEqual(requests,[{action:'parse',version:2,text:'ტექსტი'}]);
});

test('A parsed order becomes an unsaved draft with its menu total and no fees',()=>{
    const store=new Map(),context=vm.createContext({window:{},CrmModel:model,crypto:{randomUUID:()=>'draft-1'},sessionStorage:{setItem:(key,value)=>store.set(key,value),getItem:key=>store.get(key)||null}});
    vm.runInContext(fs.readFileSync(require.resolve('../crm-draft.js'),'utf8'),context);
    const draft=context.window.CrmDraft.fromParsed({name:'დაბადების დღე',clientName:'ნინო',eventDate:'2026-12-25',guests:30,notes:'',unmatched:['სუში'],items:[{name:'კანაპე',qty:60,price:3.5}]});
    assert.equal(draft.id,'draft-1');assert.equal(draft.revision,0);assert.equal(draft.status,'enquiry');
    assert.equal(draft.total,210);assert.equal(draft.serviceFee,0);assert.equal(draft.unmatched,undefined);
    assert.deepEqual(JSON.parse(store.get('chao_crm_draft_draft-1')).items,[{name:'კანაპე',qty:60,price:3.5}]);
    assert.doesNotThrow(()=>model.validate(draft,null));
});

test('A catalog or connection failure names its own cause instead of a generic error',()=>{
    let app=backend({fetch:()=>{throw new Error('You do not have permission to call UrlFetchApp.fetch');}});
    assert.equal(app.post({text:'საიდუმლო'}).error.code,'AI_NETWORK');
    assert.match(app.logs[0],/permission to call UrlFetchApp/);assert.doesNotMatch(app.logs[0],/საიდუმლო/);
    // A catalog that cannot be opened is reported as such, before any AI call.
    const context=vm.createContext({CrmModel:model,Date,Map,console:{log:()=>{},error:()=>{}},
        PropertiesService:{getScriptProperties:()=>({getProperty:()=>'k',setProperty:()=>{}})},
        SpreadsheetApp:{openById:()=>{throw new Error('No access');}},Utilities:{formatDate:()=>'2026-11-24'},
        UrlFetchApp:{fetch:()=>{throw new Error('must not be called');}},
        ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
        LockService:{getScriptLock:()=>({tryLock:()=>true,hasLock:()=>false,releaseLock:()=>{}})}});
    vm.runInContext(fs.readFileSync(require.resolve('../google-apps-script.js'),'utf8'),context);
    assert.equal(context.doPost({postData:{contents:JSON.stringify({version:2,action:'parse',text:'x'})}}).error.code,'AI_CATALOG');
});
