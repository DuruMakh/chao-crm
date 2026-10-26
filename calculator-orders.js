const saveOrderBtn = document.getElementById('saveOrderBtn');
const calculatorStatus = document.getElementById('calculatorStatus');
let activeCrmOrder = null, calculatorDirty = false, calculatorSaving = false, repriced = false;
let catalogPrices = new Map();
const plannedMenuPrices = new WeakMap();
let calculatorCatalogReady = false, calculatorLoading = false, calculatorLoadVersion = 0;
let calculatorSchedule = null, selectedDayId = '', selectedServiceId = '';
const plannerElement = id => document.getElementById(id);

function selectedDay() { return calculatorSchedule?.find(day => day.id === selectedDayId); }
function selectedService() { return selectedDay()?.services.find(service => service.id === selectedServiceId); }
function currentMenuItems() {
    return products.filter(product => (quantities[product.index] || 0) > 0)
        .map(product => ({ name: product.name, qty: quantities[product.index], price: product.price }));
}
function syncPlannedMenu() {
    const service = selectedService();
    if (!service) return;
    service.items = currentMenuItems();
    for (const item of service.items) plannedMenuPrices.get(service).set(item.name, item.price);
    service.guests = Number(peopleCountInput.value || 0);
    selectedDay().serviceFee = Number(serviceFeeInput.value || 0);
    selectedDay().transportFee = Number(transportFeeInput.value || 0);
}
function applyMenuItems(items) {
    const service = selectedService();
    const prices = (service && plannedMenuPrices.get(service)) || new Map();
    for (const item of items) prices.set(item.name, item.price);
    if (service) plannedMenuPrices.set(service, prices);
    quantities = {};
    for (const product of products) {
        product.price = prices.get(product.name) ?? catalogPrices.get(product.name) ?? product.price;
        product.unknownPrice = false;
    }
    for (const item of items) {
        let product = products.find(product => product.name === item.name);
        if (!product) { product = {name:item.name,price:item.price ?? 0,index:products.length,category:null}; products.push(product); }
        product.price = item.price ?? 0;
        product.unknownPrice = item.price == null;
        quantities[product.index] = item.qty;
    }
}
function renderPlannerTabs() {
    if (!calculatorSchedule) return;
    plannerElement('planDays').innerHTML = calculatorSchedule.map((day,index) => `<button type="button" data-day="${escapeHTML(day.id)}" aria-pressed="${day.id === selectedDayId}"><span>დღე ${index+1}</span><small>${day.date ? escapeHTML(DateInput.format(day.date)) : 'აირჩიეთ თარიღი'}</small></button>`).join('');
    plannerElement('planServices').innerHTML = selectedDay().services.map(service => `<button type="button" data-service="${escapeHTML(service.id)}" aria-pressed="${service.id === selectedServiceId}"><span>${escapeHTML(service.name || 'კვება')}</span><small${service.time ? '' : ' hidden'}>${escapeHTML(service.time)}</small></button>`).join('');
}
function updatePlannerLabels() {
    for (const button of document.querySelectorAll('#planDays [data-day]')) {
        const day = calculatorSchedule.find(day => day.id === button.dataset.day);
        button.querySelector('small').textContent = day.date ? DateInput.format(day.date) : 'აირჩიეთ თარიღი';
    }
    for (const button of document.querySelectorAll('#planServices [data-service]')) {
        const service = selectedDay().services.find(service => service.id === button.dataset.service);
        button.querySelector('span').textContent = service.name || 'კვება';
        button.querySelector('small').textContent = service.time;
        button.querySelector('small').hidden = !service.time;
    }
}
function renderPlanner() {
    const multi = !!calculatorSchedule;
    plannerElement('singleDayBtn').setAttribute('aria-pressed', !multi);
    plannerElement('multiDayBtn').setAttribute('aria-pressed', multi);
    plannerElement('multiDayPlanner').hidden = !multi;
    plannerElement('serviceFeeLabel').textContent = multi ? 'დღის სერვისი' : 'სერვისი';
    plannerElement('transportFeeLabel').textContent = multi ? 'დღის ტრანსპორტი' : 'ტრანსპორტირება';
    resetBtn.title = multi ? 'არჩეული კვების მენიუს გასუფთავება' : 'Reset all quantities';
    if (!multi) return;
    renderPlannerTabs();
    DateInput.set(plannerElement('planDate'), selectedDay().date);
    plannerElement('planServiceName').value = selectedService().name;
    plannerElement('planServiceTime').value = selectedService().time;
    plannerElement('removeDayBtn').hidden = calculatorSchedule.length < 2;
    plannerElement('removeServiceBtn').hidden = selectedDay().services.length < 2;
}
function plannerValid() {
    if (!calculatorSchedule) return true;
    for (const id of ['planDate','planServiceName','planServiceTime','peopleCountInput','serviceFeeInput','transportFeeInput']) {
        if (!plannerElement(id).reportValidity()) return false;
    }
    const date = DateInput.parse(plannerElement('planDate').value);
    if (!date) { showToast(DateInput.message); plannerElement('planDate').focus(); return false; }
    selectedDay().date = date;
    syncPlannedMenu();
    return true;
}
function selectPlannedMenu(day, service) {
    selectedDayId = day.id; selectedServiceId = service.id;
    applyMenuItems(service.items);
    peopleCount = service.guests; peopleCountInput.value = peopleCount;
    serviceFee = day.serviceFee; transportFee = day.transportFee;
    serviceFeeInput.value = serviceFee; transportFeeInput.value = transportFee;
    searchInput.value = '';
    activeViewFilter = service.items.length ? 'selected' : 'all';
    filterAllBtn.classList.toggle('active', activeViewFilter === 'all');
    filterSelectedBtn.classList.toggle('active', activeViewFilter === 'selected');
    renderPlanner(); applyFiltersAndRender(); updateTotal();
}
function nextPlanDate() {
    const date = new Date([...calculatorSchedule].map(day => day.date).filter(Boolean).sort().at(-1));
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0,10);
}
function newPlanService(name = 'ლანჩი', guests = 0) {
    return {id:crypto.randomUUID(),name,time:'',guests,items:[]};
}
function setOrderMode(multi) {
    if (!activeCrmOrder || !calculatorCatalogReady || calculatorSaving || (activeCrmOrder.pricing === 'legacy' && !repriced) || multi === !!calculatorSchedule) return;
    if (multi) {
        if (!peopleCountInput.reportValidity()) return;
        const service = {...newPlanService('ლანჩი', peopleCount),time:activeCrmOrder.eventTime,items:currentMenuItems()};
        calculatorSchedule = [{id:crypto.randomUUID(),date:activeCrmOrder.eventDate,serviceFee,transportFee,services:[service]}];
        selectPlannedMenu(calculatorSchedule[0], service);
    } else {
        const services = calculatorSchedule.flatMap(day => day.services);
        if (services.length > 1) {
            showToast('ერთდღიანზე გადასასვლელად დატოვეთ ერთი დღე და ერთი კვება. დანარჩენი ჩანაწერები წაშალეთ მხოლოდ მაშინ, თუ აღარ გჭირდებათ.');
            return;
        }
        const date = DateInput.parse(plannerElement('planDate').value);
        if (date === null) { showToast(DateInput.message); plannerElement('planDate').focus(); return; }
        activeCrmOrder.eventDate = date;
        activeCrmOrder.eventTime = selectedService().time;
        calculatorSchedule = null; renderPlanner(); updateTotal();
    }
    markCalculatorDirty();
}
plannerElement('singleDayBtn').addEventListener('click', () => setOrderMode(false));
plannerElement('multiDayBtn').addEventListener('click', () => setOrderMode(true));
plannerElement('planDays').addEventListener('click', event => {
    const button = event.target.closest('[data-day]');
    if (!button || calculatorSaving || !plannerValid()) return;
    const day = calculatorSchedule.find(day => day.id === button.dataset.day);
    selectPlannedMenu(day, day.services[0]);
    plannerElement('planDays').querySelector('[aria-pressed="true"]').focus({preventScroll:true});
});
plannerElement('planServices').addEventListener('click', event => {
    const button = event.target.closest('[data-service]');
    if (!button || calculatorSaving || !plannerValid()) return;
    selectPlannedMenu(selectedDay(), selectedDay().services.find(service => service.id === button.dataset.service));
    plannerElement('planServices').querySelector('[aria-pressed="true"]').focus({preventScroll:true});
});
for (const id of ['addDayBtn','copyDayBtn']) plannerElement(id).addEventListener('click', () => {
    if (calculatorSaving || !plannerValid()) return;
    const services = id === 'copyDayBtn' ? selectedDay().services.map(service => ({...JSON.parse(JSON.stringify(service)),id:crypto.randomUUID()})) : [newPlanService('ლანჩი', peopleCount)];
    const day = {id:crypto.randomUUID(),date:nextPlanDate(),serviceFee:id === 'copyDayBtn' ? serviceFee : 0,transportFee:id === 'copyDayBtn' ? transportFee : 0,services};
    calculatorSchedule.push(day); selectPlannedMenu(day, services[0]); markCalculatorDirty();
    plannerElement('planDate').focus();
});
plannerElement('addServiceBtn').addEventListener('click', () => {
    if (calculatorSaving || !plannerValid()) return;
    const service = newPlanService('ყავის შესვენება', peopleCount);
    selectedDay().services.push(service); selectPlannedMenu(selectedDay(), service); markCalculatorDirty();
    plannerElement('planServiceName').focus();
});
plannerElement('removeDayBtn').addEventListener('click', () => {
    if (calculatorSaving || calculatorSchedule.length < 2 || !confirm('წაიშალოს არჩეული დღე და მისი ყველა მენიუ?')) return;
    calculatorSchedule = calculatorSchedule.filter(day => day.id !== selectedDayId);
    selectPlannedMenu(calculatorSchedule[0], calculatorSchedule[0].services[0]); markCalculatorDirty();
    plannerElement('planDate').focus();
});
plannerElement('removeServiceBtn').addEventListener('click', () => {
    const day = selectedDay();
    if (calculatorSaving || day.services.length < 2 || !confirm('წაიშალოს არჩეული კვება და მისი მენიუ?')) return;
    day.services = day.services.filter(service => service.id !== selectedServiceId);
    selectPlannedMenu(day, day.services[0]); markCalculatorDirty(); plannerElement('planServiceName').focus();
});
for (const id of ['planDate','planServiceName','planServiceTime']) {
    plannerElement(id).addEventListener('input', () => {
        if (!calculatorSchedule || calculatorSaving) return;
        if (id === 'planDate') {
            const date = DateInput.parse(plannerElement(id).value);
            if (date !== null) selectedDay().date = date;
        } else selectedService()[id === 'planServiceName' ? 'name' : 'time'] = plannerElement(id).value;
        updatePlannerLabels(); updateTotal(); markCalculatorDirty();
    });
}

function showToast(message) { calculatorStatus.textContent = message; }
function renderDayBreakdown(summary) {
    plannerElement('planCostBreakdown').hidden = !summary.schedule;
    if (!summary.schedule) return;
    const money = value => `₾ ${value.toFixed(CONFIG.DECIMALS)}`;
    plannerElement('planDayTotals').innerHTML = [...summary.schedule].sort((a,b) => a.date.localeCompare(b.date)).map(day => {
        const meals = [...day.services].sort((a,b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
        return `<section class="plan-day-cost"><h3>${escapeHTML(DateInput.format(day.date) || 'თარიღი დასაზუსტებელია')}</h3><dl>
            ${meals.map(service => `<div><dt>${escapeHTML([service.time, service.name].filter(Boolean).join(' · '))}</dt><dd>${money(CrmModel.total({items:service.items,serviceFee:0,transportFee:0}))}</dd></div>`).join('')}
            <div><dt>სერვისი</dt><dd>${money(day.serviceFee)}</dd></div>
            <div><dt>ტრანსპორტირება</dt><dd>${money(day.transportFee)}</dd></div>
            <div class="plan-day-grand-total"><dt>დღის ჯამი</dt><dd>${money(CrmModel.dayTotal(day))}</dd></div>
        </dl></section>`;
    }).join('');
}
function getCurrentOrderSummary() {
    if (activeCrmOrder?.pricing === 'legacy' && !repriced) {
        return { total:activeCrmOrder.total,items:activeCrmOrder.items,itemCount:activeCrmOrder.items.reduce((sum,item)=>sum+item.qty,0),serviceFee,transportFee };
    }
    syncPlannedMenu();
    const items = calculatorSchedule ? CrmModel.scheduleItems(calculatorSchedule) : currentMenuItems();
    const fees = calculatorSchedule ? CrmModel.scheduleFees(calculatorSchedule) : {serviceFee,transportFee};
    return {items,schedule:calculatorSchedule,total:CrmModel.total({items,...fees}),itemCount:items.reduce((sum,item)=>sum+item.qty,0),...fees};
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
    for (const control of document.querySelectorAll('.order-planner button,.order-planner input')) control.disabled = locked;
}
function markCalculatorDirty() {
    if (!activeCrmOrder || !calculatorCatalogReady || calculatorSaving) return;
    calculatorDirty = true; showToast(activeCrmOrder.revision ? 'ცვლილებები ჯერ არ არის შენახული.' : '„შენახვა“ გახსნის კლიენტისა და კომპანიის დეტალებს. შეკვეთა იქ შეინახება.');
}
function applyCalculatorCatalog(catalog) {
    products = catalog.products; categories = catalog.categories;
    catalogPrices = new Map(products.map(product=>[product.name,product.price]));
    applyMenuItems(selectedService()?.items || activeCrmOrder.items);
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
        repriced = false;
        calculatorSchedule = JSON.parse(JSON.stringify(CrmModel.scheduleWithFees(order)));
        selectedDayId = calculatorSchedule?.[0].id || '';
        selectedServiceId = calculatorSchedule?.[0].services[0].id || '';
        applyCalculatorCatalog(catalog || {products:[],categories:[]});
        calculatorCatalogReady = !!catalog;
        serviceFee = selectedDay()?.serviceFee ?? activeCrmOrder.serviceFee; transportFee = selectedDay()?.transportFee ?? activeCrmOrder.transportFee; peopleCount = selectedService()?.guests ?? activeCrmOrder.guests;
        serviceFeeInput.value = serviceFee; transportFeeInput.value = transportFee; peopleCountInput.value = peopleCount;
        document.getElementById('calculatorOrderName').textContent = activeCrmOrder.name || activeCrmOrder.clientName || 'ახალი შეკვეთა · მენიუს შედგენა';
        document.getElementById('ordersBack').href = id ? `index.html#order=${encodeURIComponent(id)}` : 'index.html';
        document.getElementById('legacyWarning').classList.toggle('hidden',activeCrmOrder.pricing !== 'legacy');
        activeViewFilter = activeCrmOrder.items.length ? 'selected' : 'all';
        filterAllBtn.classList.toggle('active',activeViewFilter==='all'); filterSelectedBtn.classList.toggle('active',activeViewFilter==='selected');
        renderPlanner();
        if (catalog) { showProducts(); applyFiltersAndRender(); }
        updateTotal(); updateButtonsState();
        calculatorDirty = false; showToast(calculatorReadyMessage());
        if (catalog && params.has('mode')) setOrderMode(params.get('mode') === 'multi');
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
    if (!plannerValid()) return;
    const summary=getCurrentOrderSummary();
    let schedule = null;
    try { if (calculatorSchedule) schedule = CrmModel.validateSchedule(calculatorSchedule); }
    catch(error) { showToast(error.message); return; }
    const draft={...activeCrmOrder,schedule,items:summary.items,total:summary.total,serviceFee:summary.serviceFee,transportFee:summary.transportFee,guests:schedule ? CrmModel.scheduleGuests(schedule) : Number(peopleCountInput.value || 0),pricing:repriced?'snapshot':activeCrmOrder.pricing};
    if (schedule) { draft.eventDate = schedule[0].date; draft.eventTime = schedule[0].services[0].time; }
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
window.addEventListener('beforeunload',event=>{if(calculatorDirty||calculatorSaving){event.preventDefault();event.returnValue='';}});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeInvoiceModal();});
