const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {jsPDF}=require('../vendor/jspdf.umd.min.js');
const {autoTable}=require('../vendor/jspdf.plugin.autotable.min.js');

test('Every invoice page with product rows repeats the quantity, unit price and amount labels',()=>{
    const labels=['რაოდენობა','ერთ. ფასი','თანხა'],pagesWithItems=new Set(),pageLabels=new Map();
    const context=vm.createContext({Uint8Array,window:{jspdf:{jsPDF},autoTable(pdf,options){
        autoTable(pdf,{...options,didDrawCell(data){
            const page=pdf.internal.getCurrentPageInfo().pageNumber;
            if(data.section==='body'&&data.cell.text.some(text=>text.startsWith('Product ')))pagesWithItems.add(page);
            if(data.section==='head'){
                if(!pageLabels.has(page))pageLabels.set(page,new Set());
                for(const text of data.cell.text)pageLabels.get(page).add(text);
            }
        }});
    }}});
    vm.runInContext(fs.readFileSync(require.resolve('../invoice-pdf.js'),'utf8'),context);
    const cell=(text,span=1)=>({text:String(text),span,align:'left'});
    const rows=[{group:true,cells:[cell('Day 1 / Lunch',5)]},{cells:['1','Product first','1','5.00','5.00'].map(value=>cell(value))},
        {group:true,cells:[cell('Day 2 / Lunch',5)]},...Array.from({length:75},(_,i)=>({cells:[String(i+2),'Product '+i,'2','3.00','6.00'].map(value=>cell(value))}))];
    const asset=file=>fs.readFileSync(path.join(__dirname,'../assets',file)).toString('base64');
    const bytes=context.InvoicePdf.build({type:'detailed',number:'TEST',guests:30,date:'26.10.2026',dueDate:'27.10.2026',payerName:'Test',payerId:'-',supplier:['Chao'],
        head:['#','დასახელება',...labels].map(value=>cell(value)),rows},
        {normal:asset('NotoSansGeorgian-Regular.ttf'),bold:asset('NotoSansGeorgian-Bold.ttf'),logo:'data:image/png;base64,'+asset('chao-logo.png')});
    assert.ok(bytes.length>1000);assert.ok(pagesWithItems.size>=3);
    for(const page of pagesWithItems)for(const label of labels)assert.ok(pageLabels.get(page)?.has(label),`Page ${page} is missing ${label}`);
});
