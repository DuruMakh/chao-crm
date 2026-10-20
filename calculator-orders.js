const saveOrderBtn = document.getElementById('saveOrderBtn');
const calculatorStatus = document.getElementById('calculatorStatus');
let activeCrmOrder = null, calculatorDirty = false, calculatorSaving = false, repriced = false;
let catalogPrices = new Map();
let calculatorCatalogReady = false, calculatorLoading = false, calculatorLoadVersion = 0;

function showToast(message) { calculatorStatus.textContent = message; }
function getCurrentOrderSummary() {
    if (activeCrmOrder?.pricing === 'legacy' && !repriced) {
        return { total:activeCrmOrder.total,items:activeCrmOrder.items,itemCount:activeCrmOrder.items.reduce((sum,item)=>sum+item.qty,0),serviceFee,transportFee };
    }
    const items = products.filter(product=>(quantities[product.index]||0)>0).map(product=>({name:product.name,qty:quantities[product.index],price:product.price}));
    return {items,total:CrmModel.total({items,serviceFee,transportFee}),itemCount:items.reduce((sum,item)=>sum+item.qty,0),serviceFee,transportFee};
}
function updateButtonsState() {
    const locked = !activeCrmOrder || !calculatorCatalogReady || calculatorSaving || (activeCrmOrder.pricing === 'legacy' && !repriced);
    saveOrderBtn.disabled = locked;
    saveOrderBtn.classList.toggle('enabled', !locked);
    saveOrderBtn.classList.toggle('new-order', !!activeCrmOrder && !activeCrmOrder.revision);
    invoiceBtn.classList.toggle('hidden', !!activeCrmOrder && !activeCrmOrder.revision);
    invoiceBtn.disabled = !activeCrmOrder?.revision || calculatorSaving || getCurrentOrderSummary().total <= 0;
    invoiceBtn.classList.toggle('enabled', !invoiceBtn.disabled);
    resetBtn.disabled = locked;
    document.getElementById('repriceBtn').disabled = !calculatorCatalogReady || calculatorSaving;
    for (const control of [searchInput, filterAllBtn, filterSelectedBtn]) control.disabled = !calculatorCatalogReady;
    for (const control of document.querySelectorAll('.qty-input,.qty-btn,#serviceFeeInput,#transportFeeInput,#peopleCountInput')) {
        control.disabled = locked || (control.dataset.action === 'minus' && !(quantities[control.dataset.idx] > 0));
    }
}
function markCalculatorDirty() {
    if (!activeCrmOrder || !calculatorCatalogReady || calculatorSaving) return;
    calculatorDirty = true; showToast(activeCrmOrder.revision ? 'ცვლილებები ჯერ არ არის შენახული.' : '„შენახვა“ გახსნის კლიენტისა და კომპანიის დეტალებს. შეკვეთა იქ შეინახება.');
}
function applyCalculatorCatalog(catalog) {
    products = catalog.products; categories = catalog.categories;
    catalogPrices = new Map(products.map(product=>[product.name,product.price]));
    quantities = {};
    for (const item of activeCrmOrder.items) {
        let product = products.find(product=>product.name===item.name);
        if (!product) { product = {name:item.name,price:item.price ?? 0,index:products.length,category:null}; products.push(product); }
        product.price = item.price ?? 0;
        product.unknownPrice = item.price == null;
        quantities[product.index] = item.qty;
    }
}
function calculatorReadyMessage() {
    return !activeCrmOrder.revision ? 'შეადგინეთ მენიუ. „შენახვა“ გახსნის კლიენტისა და კომპანიის დეტალებს.' : activeCrmOrder.pricing==='legacy' ? 'შენახული ჯამი. ძველი ერთეულის ფასები უცნობია.' : 'შენახული ფასები გამოიყენება.';
}
function catalogError(error) {
    return error.name === 'TimeoutError' ? 'ჩატვირთვას დიდი დრო დასჭირდა. სცადეთ ხელახლა.' : error.message;
}
async function loadCalculatorCatalog() {
    if (!activeCrmOrder || calculatorLoading || calculatorCatalogReady) return;
    const request = ++calculatorLoadVersion;
    calculatorLoading = true; showLoading(); updateButtonsState();
    try {
        const catalog = await fetchProducts();
        if (request !== calculatorLoadVersion) return;
        applyCalculatorCatalog(catalog); calculatorCatalogReady = true;
        showProducts(); applyFiltersAndRender(); updateTotal(); showToast(calculatorReadyMessage());
    } catch(error) {
        if (request !== calculatorLoadVersion) return;
        showToast(catalogError(error)); showError(catalogError(error));
    } finally {
        if (request === calculatorLoadVersion) { calculatorLoading = false; updateButtonsState(); }
    }
}
async function initCalculator() {
    const params = new URLSearchParams(location.search), id = params.get('order');
    const request = ++calculatorLoadVersion, invoiceOnly = id && params.has('invoice');
    calculatorLoading = true; calculatorCatalogReady = false; activeCrmOrder = null;
    showToast('შეკვეთა იტვირთება…'); showLoading(); updateButtonsState();
    try {
        let orderPromise;
        if (id) orderPromise = CrmApi.list().then(orders=>{
            const order = orders.find(order=>order.id===id);
            if (!order) throw new Error('შეკვეთა ვერ მოიძებნა. დაბრუნდით შეკვეთების სიაში.');
            return order;
        });
        else {
            const draft = params.has('draft') ? CrmDraft.load(params.get('draft')) : CrmDraft.create();
            if (!draft) throw new Error('შეკვეთის მონახაზი აღარ არის ხელმისაწვდომი. დაბრუნდით სიაში და გახსენით შეკვეთა ან დაამატეთ ახალი.');
            history.replaceState(null,'',`calculator.html?draft=${encodeURIComponent(draft.id)}`);
            orderPromise = Promise.resolve(draft);
        }
        const [order, catalog] = await Promise.all([orderPromise, invoiceOnly ? null : fetchProducts()]);
        if (request !== calculatorLoadVersion) return;
        activeCrmOrder = order;
        applyCalculatorCatalog(catalog || {products:[],categories:[]});
        calculatorCatalogReady = !!catalog;
        serviceFee = activeCrmOrder.serviceFee; transportFee = activeCrmOrder.transportFee; peopleCount = activeCrmOrder.guests;
        serviceFeeInput.value = serviceFee; transportFeeInput.value = transportFee; peopleCountInput.value = peopleCount;
        document.getElementById('calculatorOrderName').textContent = activeCrmOrder.name || activeCrmOrder.clientName || 'ახალი შეკვეთა · მენიუს შედგენა';
        document.getElementById('ordersBack').href = id ? `index.html#order=${encodeURIComponent(id)}` : 'index.html';
        document.getElementById('legacyWarning').classList.toggle('hidden',activeCrmOrder.pricing !== 'legacy');
        activeViewFilter = activeCrmOrder.items.length ? 'selected' : 'all';
        filterAllBtn.classList.toggle('active',activeViewFilter==='all'); filterSelectedBtn.classList.toggle('active',activeViewFilter==='selected');
        if (catalog) { showProducts(); applyFiltersAndRender(); }
        updateTotal(); updateButtonsState();
        calculatorDirty = false; showToast(calculatorReadyMessage());
        if (invoiceOnly) {
            calculatorLoading = false;
            if (getCurrentOrderSummary().total > 0) openInvoiceModal();
            else loadCalculatorCatalog();
        }
    } catch(error) {
        if (request !== calculatorLoadVersion) return;
        activeCrmOrder=null; showToast(catalogError(error)); showError(catalogError(error)); updateButtonsState();
    } finally {
        if (request === calculatorLoadVersion) calculatorLoading = false;
    }
}
document.getElementById('repriceBtn').addEventListener('click',()=>{
    if (!activeCrmOrder || !calculatorCatalogReady || calculatorSaving) return;
    const missing = activeCrmOrder.items.filter(item=>!catalogPrices.has(item.name));
    if(missing.length){showToast('კატალოგში აკლია: '+missing.map(item=>item.name).join(', ')+'. გადაანგარიშებამდე დაამატეთ მათი ფასი კატალოგში.');return;}
    for(const product of products){if(catalogPrices.has(product.name)) product.price=catalogPrices.get(product.name);product.unknownPrice=false;}
    repriced=true;document.getElementById('legacyWarning').classList.add('hidden');
    applyFiltersAndRender();updateTotal();updateButtonsState();markCalculatorDirty();
    showToast('ნაჩვენებია ახალი ჯამი. ძველი შეკვეთა შეიცვლება მხოლოდ შენახვის შემდეგ.');
});
saveOrderBtn.addEventListener('click',async()=>{
    if(!activeCrmOrder || !calculatorCatalogReady || calculatorSaving) return;
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
