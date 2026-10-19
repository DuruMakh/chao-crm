// Local preview only. --demo uses disposable in-memory orders, never the Google Sheet.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const demo = process.argv.includes('--demo');
const port = demo ? 8767 : 8766;
const context = vm.createContext({CrmModel:require('../crm-model.js')});
vm.runInContext(fs.readFileSync(path.join(root,'google-apps-script.js'),'utf8'),context);
let failNext=false, loseNext=false;
const seed = (id,name,date,status,total,paid) => ({id,name,eventDate:date,status,total,paid,phone:'555 123 456',eventTime:'18:00',location:'თბილისი',guests:30,notes:'',serviceFee:0,transportFee:0,pricing:'snapshot',items:total?[{name:'კანაპე',qty:30,price:total/30}]:[],revision:1,lastRequestId:'',createdAt:'2026-10-19T10:00:00.000Z',updatedAt:'2026-10-19T10:00:00.000Z'});
let orders = [seed('demo-1','ნინოს დაბადების დღე','2026-10-24','confirmed',900,300),seed('demo-2','გუნდის შეხვედრა','2026-10-28','quoted',600,0),seed('demo-3','ახალი მოთხოვნა','','enquiry',0,0),{...seed('legacy-demo','ძველი შეკვეთა','','enquiry',543.21,null),pricing:'legacy',items:[{name:'კანაპე',qty:30,price:null}]},seed('done-demo','დასრულებული ღონისძიება','2026-10-01','completed',600,600)];
http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    res.setHeader('Cache-Control','no-store');
    if(demo && pathname==='/__test/fail'){failNext=true;res.end('ok');return;}
    if(demo && pathname==='/__test/lose'){loseNext=true;res.end('ok');return;}
    if(demo && pathname==='/__demo_api'){
        res.setHeader('Content-Type','application/json');
        if(req.method==='GET'){res.end(JSON.stringify({success:true,version:2,orders}));return;}
        let body='';for await(const chunk of req) body+=chunk;
        if(failNext){failNext=false;res.writeHead(503);res.end('{}');return;}
        try{const data=JSON.parse(body),deleting=data.action==='delete';
            const result=deleting?context.prepareDelete(data,orders):context.prepareSave(data,orders,new Date().toISOString());
            if(result.changed) orders=deleting?orders.filter(o=>o.id!==result.deletedId):orders.filter(o=>o.id!==result.order.id).concat(result.order);
            if(loseNext){loseNext=false;res.destroy();return;}
            res.end(JSON.stringify({success:true,version:2,...(deleting?{deletedId:result.deletedId}:{order:result.order})}));
        }catch(error){res.end(JSON.stringify({success:false,version:2,error:{code:error.code,message:error.message}}));}return;
    }
    if(demo && pathname==='/__demo_catalog'){res.setHeader('Content-Type','text/csv; charset=utf-8');res.end('Name,Notes,Price\nკანაპე,,30\nდესერტი,,5\n');return;}
    const file=path.resolve(root,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)||path.relative(root,file).split(path.sep).some(p=>p.startsWith('.'))){res.writeHead(404);res.end();return;}
    try{
        let body=fs.readFileSync(file);
        if(demo && path.basename(file)==='crm-config.js')body=Buffer.from('window.CRM_CONFIG={apiUrl:"/__demo_api",spreadsheetUrl:"https://docs.google.com/spreadsheets/d/1SI6Ah8MjtQ_rw7Ah_DeX0-ism7xP-RnAFUwl7eR2Z6U/edit"};');
        if(demo && path.basename(file)==='app.js')body=Buffer.from(body.toString().replace(/return \x60https:\/\/docs.google.com[^;]+;/,'return "/__demo_catalog";'));
        if(demo && path.extname(file)==='.html')body=Buffer.from(body.toString().replace('<body>','<body><div style="padding:8px 16px;background:#493367;color:white;text-align:center;font:13px system-ui">Local preview · Test data only</div>'));
        res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'})[path.extname(file)]||'text/plain');res.end(body);
    }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log('CRM preview: http://127.0.0.1:'+port+(demo?' (test data)':'')));
