const saveOrderBtn = document.getElementById('saveOrderBtn');
const calculatorStatus = document.getElementById('calculatorStatus');
let activeCrmOrder = null, calculatorDirty = false, calculatorSaving = false, repriced = false;
let catalogPrices = new Map();

function showToast(message) { calculatorStatus.textContent = message; }
function getCurrentOrderSummary() {
    if (activeCrmOrder?.pricing === 'legacy' && !repriced) {
        return { total:activeCrmOrder.total,items:activeCrmOrder.items,itemCount:activeCrmOrder.items.reduce((sum,item)=>sum+item.qty,0),serviceFee,transportFee };
    }
    const items = products.filter(product=>(quantities[product.index]||0)>0).map(product=>({name:product.name,qty:quantities[product.index],price:product.price}));
    return {items,total:CrmModel.total({items,serviceFee,transportFee}),itemCount:items.reduce((sum,item)=>sum+item.qty,0),serviceFee,transportFee};
}
function updateButtonsState() {
    const locked = !activeCrmOrder || calculatorSaving || (activeCrmOrder.pricing === 'legacy' && !repriced);
    saveOrderBtn.disabled = locked;
    saveOrderBtn.classList.toggle('enabled', !locked);
    saveOrderBtn.classList.toggle('new-order', !!activeCrmOrder && !activeCrmOrder.revision);
    invoiceBtn.classList.toggle('hidden', !!activeCrmOrder && !activeCrmOrder.revision);
    invoiceBtn.disabled = !activeCrmOrder?.revision || calculatorSaving || getCurrentOrderSummary().total <= 0;
    invoiceBtn.classList.toggle('enabled', !invoiceBtn.disabled);
    resetBtn.disabled = locked;
    for (const control of document.querySelectorAll('.qty-input,.qty-btn,#serviceFeeInput,#transportFeeInput,#peopleCountInput')) {
        control.disabled = locked || (control.dataset.action === 'minus' && !(quantities[control.dataset.idx] > 0));
    }
}
function markCalculatorDirty() {
    if (!activeCrmOrder || calculatorSaving) return;
    calculatorDirty = true; showToast(activeCrmOrder.revision ? 'ცვლილებები ჯერ არ არის შენახული.' : '„შენახვა“ გახსნის კლიენტისა და კომპანიის დეტალებს. შეკვეთა იქ შეინახება.');
}
async function initCalculator() {
    const params = new URLSearchParams(location.search), id = params.get('order');
    showToast('შეკვეთა იტვირთება…'); updateButtonsState();
    try {
        if (id) {
            const allOrders = await CrmApi.list();
            activeCrmOrder = allOrders.find(order=>order.id===id);
            if (!activeCrmOrder) throw new Error('შეკვეთა ვერ მოიძებნა. დაბრუნდით შეკვეთების სიაში.');
        } else {
            activeCrmOrder = params.has('draft') ? CrmDraft.load(params.get('draft')) : CrmDraft.create();
            if (!activeCrmOrder) throw new Error('შეკვეთის მონახაზი აღარ არის ხელმისაწვდომი. დაბრუნდით სიაში და გახსენით შეკვეთა ან დაამატეთ ახალი.');
            history.replaceState(null,'',`calculator.html?draft=${encodeURIComponent(activeCrmOrder.id)}`);
        }
        if (!await fetchProducts()) throw new Error('მენიუ ვერ ჩაიტვირთა. სცადეთ ხელახლა.');
        catalogPrices = new Map(products.map(product=>[product.name,product.price]));
        for (const item of activeCrmOrder.items) {
            let product = products.find(product=>product.name===item.name);
            if (!product) { product = {name:item.name,price:item.price ?? 0,index:products.length,category:null}; products.push(product); }
            product.price = item.price ?? 0;
            product.unknownPrice = item.price == null;
            quantities[product.index] = item.qty;
        }
        serviceFee = activeCrmOrder.serviceFee; transportFee = activeCrmOrder.transportFee; peopleCount = activeCrmOrder.guests;
        serviceFeeInput.value = serviceFee; transportFeeInput.value = transportFee; peopleCountInput.value = peopleCount;
        document.getElementById('calculatorOrderName').textContent = activeCrmOrder.name || activeCrmOrder.clientName || 'ახალი შეკვეთა · მენიუს შედგენა';
        document.getElementById('ordersBack').href = id ? `index.html#order=${encodeURIComponent(id)}` : 'index.html';
        document.getElementById('legacyWarning').classList.toggle('hidden',activeCrmOrder.pricing !== 'legacy');
        activeViewFilter = activeCrmOrder.items.length ? 'selected' : 'all';
        filterAllBtn.classList.toggle('active',activeViewFilter==='all'); filterSelectedBtn.classList.toggle('active',activeViewFilter==='selected');
        applyFiltersAndRender(); updateTotal(); updateButtonsState();
        calculatorDirty = false; showToast(!activeCrmOrder.revision ? 'შეადგინეთ მენიუ. „შენახვა“ გახსნის კლიენტისა და კომპანიის დეტალებს.' : activeCrmOrder.pricing==='legacy' ? 'შენახული ჯამი. ძველი ერთეულის ფასები უცნობია.' : 'შენახული ფასები გამოიყენება.');
        if (id && params.has('invoice')) openInvoiceModal();
    } catch(error) { activeCrmOrder=null; showToast(error.message); showError(error.message); updateButtonsState(); }
}
document.getElementById('repriceBtn').addEventListener('click',()=>{
    const missing = activeCrmOrder.items.filter(item=>!catalogPrices.has(item.name));
    if(missing.length){showToast('კატალოგში აკლია: '+missing.map(item=>item.name).join(', ')+'. გადაანგარიშებამდე დაამატეთ მათი ფასი კატალოგში.');return;}
    for(const product of products){if(catalogPrices.has(product.name)) product.price=catalogPrices.get(product.name);product.unknownPrice=false;}
    repriced=true;document.getElementById('legacyWarning').classList.add('hidden');
    applyFiltersAndRender();updateTotal();updateButtonsState();markCalculatorDirty();
    showToast('ნაჩვენებია ახალი ჯამი. ძველი შეკვეთა შეიცვლება მხოლოდ შენახვის შემდეგ.');
});
saveOrderBtn.addEventListener('click',async()=>{
    if(!activeCrmOrder || calculatorSaving) return;
    for (const input of [serviceFeeInput,transportFeeInput,peopleCountInput]) if (!input.reportValidity()) return;
    const summary=getCurrentOrderSummary();
    const draft={...activeCrmOrder,items:summary.items,total:summary.total,serviceFee,transportFee,guests:peopleCount,pricing:repriced?'snapshot':activeCrmOrder.pricing};
    if (!activeCrmOrder.revision) {
        try {
            CrmDraft.save(draft); calculatorDirty=false;
            location.href=`index.html#draft=${encodeURIComponent(draft.id)}`;
        } catch(error) { showToast(error.message); }
        return;
    }
    try { CrmModel.validate(draft,activeCrmOrder); } catch(error){showToast(error.message);return;}
    calculatorSaving=true;updateButtonsState();showToast('ინახება…');
    try {activeCrmOrder=await CrmApi.save(draft);calculatorDirty=false;repriced=false;showToast('შეკვეთა შენახულია. შეგიძლიათ დაბრუნდეთ შეკვეთის დეტალებში.');}
    catch(error){showToast(error.message+'\nთქვენი ცვლილებები დარჩა ეკრანზე. სცადეთ ხელახლა.');}
    finally{calculatorSaving=false;updateButtonsState();}
});
for(const control of [serviceFeeInput,transportFeeInput,peopleCountInput]) control.addEventListener('input',markCalculatorDirty);
productsList.addEventListener('input',event=>{if(event.target.matches('.qty-input'))markCalculatorDirty();});
productsList.addEventListener('click',event=>{if(event.target.closest('.qty-btn'))markCalculatorDirty();});
resetBtn.addEventListener('click',markCalculatorDirty);
window.addEventListener('beforeunload',event=>{if(calculatorDirty||calculatorSaving){event.preventDefault();event.returnValue='';}});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeInvoiceModal();});
