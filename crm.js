/* One order, from first enquiry through payment and the event. */
const $ = id => document.getElementById(id);
const money = value => `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₾`;
const escape = value => { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; };
let orders = CrmApi.cachedOrders(), activeOrder = null, dirty = false, saving = false, connected = false, activeHash = '';
let refreshing = false, refreshSequence = 0, refreshError = '';
const detailFields = ['name','clientName','companyName','companyCode','email','phone','eventDate','eventTime','location','guests','status','notes','paid'];
const stageOptions = Object.entries(CrmModel.stages).map(([value,label]) => `<option value="${value}">${label}</option>`).join('');
$('stageFilter').insertAdjacentHTML('beforeend', stageOptions);
const stageIcons = {
    enquiry:'<path d="M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 19 0Z"/><path d="M7 10h10M7 14h6"/>',
    quoted:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    confirmed:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 5 3 3 5-5"/>',
    paid:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h3m4 0h3"/>',
    completed:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    cancelled:'<path d="m7 7 10 10M7 17 17 7"/>',
};
const flowStages = Object.keys(CrmModel.stages).filter(stage=>stage!=='cancelled');
function stageControl(stage) {
    const label = CrmModel.stages[stage];
    return `<div class="stage-step"><input class="stage-input" type="radio" name="orderStage" id="stage-${stage}" value="${stage}" aria-label="${label}"><label class="stage-choice" for="stage-${stage}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${stageIcons[stage]}</svg><span class="stage-tooltip" aria-hidden="true">${label}</span></label></div>`;
}
$('stageFlow').insertAdjacentHTML('beforeend', flowStages.map(stageControl).join(''));
$('stageCancel').innerHTML = stageControl('cancelled');
function renderStagePicker() {
    const selected = $('status').value, index = flowStages.indexOf(selected);
    for (const stage of Object.keys(CrmModel.stages)) {
        const input = $(`stage-${stage}`);
        input.checked = stage === selected;
        input.closest('.stage-step').classList.toggle('is-past', flowStages.indexOf(stage)>=0 && flowStages.indexOf(stage)<index);
    }
    $('stageProgress').style.width = `${Math.max(0,index) / (flowStages.length-1) * 100}%`;
    $('stageCurrent').textContent = CrmModel.stages[selected];
    $('stageCurrent').className = `stage stage-${selected}`;
}
async function saveStage(stage) {
    if (saving || !activeOrder || !$('deleteConfirm').hidden || stage === activeOrder.status) return;
    const stageHadFocus = document.activeElement?.name === 'orderStage';
    $('status').value = stage; renderStagePicker();
    saving = true; $('formFields').disabled = true; $('saveBtn').disabled = true; $('deleteBtn').disabled = true;
    $('stageSaveState').textContent = 'ინახება…'; $('stageSaveState').classList.remove('error'); notice('');
    try {
        if (!activeOrder.revision) {
            const draft = {...activeOrder};
            for (const key of detailFields) draft[key] = $(key).value;
            CrmDraft.save(draft);
            activeOrder.status = stage; dirty = true;
            $('stageSaveState').textContent = 'მონახაზში შენახულია';
            $('saveState').textContent = 'ჯერ არ არის შენახული';
        } else {
            // Save only the stage from the confirmed order; keep other form edits pending.
            const saved = await CrmApi.save({...activeOrder,status:stage});
            orders = orders.filter(order=>order.id!==saved.id).concat(saved);
            activeOrder = saved;
            $('status').value = saved.status; renderStagePicker();
            $('stageSaveState').textContent = 'შენახულია';
            $('saveState').textContent = dirty ? 'ცვლილებები შესანახია' : 'ყველა ცვლილება შენახულია';
        }
    } catch (error) {
        $('status').value = activeOrder.status; renderStagePicker();
        $('stageSaveState').textContent = 'ვერ შეინახა'; $('stageSaveState').classList.add('error');
        notice(`${error.message} სტატუსის ცვლილება ვერ დადასტურდა. აირჩიეთ ეტაპი ხელახლა.`, 'error');
    } finally {
        saving = false; $('formFields').disabled = false; $('saveBtn').disabled = false; $('deleteBtn').disabled = false;
        if (stageHadFocus && document.activeElement === document.body) $(`stage-${$('status').value}`).focus({preventScroll:true});
    }
}
$('sheetLink').href = CRM_CONFIG.spreadsheetUrl;

function notice(message, kind = '') {
    $('notice').textContent = message;
    $('notice').className = `notice ${kind}`;
    $('notice').hidden = !message;
}
function connectionNotice() {
    const state = CrmApi.cachedState();
    const age = state.refreshedAt ? `ბოლო სრული განახლება: ${new Intl.DateTimeFormat('ka-GE',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Tbilisi'}).format(new Date(state.refreshedAt))}.` : 'ბოლო სრული განახლების დრო უცნობია.';
    const copy = state.available ? `ნაჩვენებია ბოლო დადასტურებული ასლი. ${age}` : '';
    if (refreshing) notice(`${copy} ${state.available ? 'მოწმდება განახლებები…' : 'შეკვეთები იტვირთება…'}`.trim());
    else if (!connected) notice(`${refreshError} ${copy} ხელახლა დასაკავშირებლად დააჭირეთ განახლებას.`.trim(), 'error');
    else notice('');
}
function renderList() {
    const focused = document.activeElement?.matches?.('#orderRows .order-name') ? document.activeElement.getAttribute('href') : null;
    const term = $('orderSearch').value.trim().toLowerCase(), stage = $('stageFilter').value;
    const visible = CrmModel.sortOrders(orders).filter(order => {
        const matchesStage = stage === 'all' || (stage === 'active' ? !['completed','cancelled'].includes(order.status) : order.status === stage);
        return matchesStage && [order.name,order.clientName,order.companyName,order.companyCode,order.email,order.phone,order.location,order.notes].join(' ').toLowerCase().includes(term);
    });
    $('orderCount').textContent = `${visible.length} შეკვეთა`;
    $('orderRows').innerHTML = visible.map(order => {
        const balance = CrmModel.balance(order);
        const paid = balance == null ? 'გადახდა უცნობია' : balance < 0 ? `ზედმეტობა ${money(-balance)}` : balance === 0 ? (order.total ? 'გადახდილია' : 'თანხა ჯერ არ არის') : `დარჩენილი ${money(balance)}`;
        const contact = [order.name ? order.clientName : '',order.companyName].filter(Boolean).join(' · ');
        return `<tr><td><a class="order-name" href="#order=${encodeURIComponent(order.id)}">${escape(order.name || order.clientName)}</a><div class="order-meta">${escape(contact || order.location || order.phone || 'დეტალები შესავსებია')}</div></td><td class="event-cell">${order.eventDate ? escape(order.eventDate.split('-').reverse().join('.')) : 'თარიღი დასაზუსტებელია'}<div class="order-meta">${escape(order.eventTime)}${order.guests ? ` · ${order.guests} სტუმარი` : ''}</div></td><td class="stage-cell"><span class="stage stage-${order.status}">${CrmModel.stages[order.status] || 'უცნობი'}</span></td><td class="quote-cell"><div class="money">${money(order.total)}</div><div class="order-meta">${paid}</div></td></tr>`;
    }).join('');
    $('emptyList').hidden = !!visible.length;
    $('ordersTable').hidden = !visible.length;
    $('emptyTitle').textContent = orders.length ? 'შეკვეთა ვერ მოიძებნა' : 'პირველი შეკვეთა აქ გამოჩნდება';
    $('emptyText').textContent = orders.length ? 'შეცვალეთ ძიება ან სტატუსის ფილტრი.' : 'ახალი შეკვეთისთვის ჯერ შეადგინეთ მენიუ.';
    if (!orders.length && refreshing && !CrmApi.cachedState().available) {
        $('emptyTitle').textContent = 'შეკვეთები იტვირთება…';
        $('emptyText').textContent = 'ახალი შეკვეთის შექმნა ახლავე შეგიძლიათ.';
    }
    if (focused) ([...$('orderRows').querySelectorAll('.order-name')].find(link=>link.getAttribute('href')===focused) || $('orderSearch')).focus({preventScroll:true});
}
function openOrder(order, focus = true) {
    activeHash = location.hash;
    activeOrder = structuredClone(order);
    $('listView').hidden = true; $('detailView').hidden = false;
    $('detailTitle').textContent = order.revision ? (order.name || order.clientName) : 'ახალი შეკვეთა';
    $('detailSubtitle').textContent = order.revision ? `შეკვეთა ${order.id}` : 'შეავსეთ კლიენტის, კომპანიისა და ღონისძიების დეტალები, შემდეგ შეინახეთ შეკვეთა.';
    $('detailBack').textContent = order.revision ? '← ყველა შეკვეთა' : '← მენიუს შეცვლა';
    $('detailBack').href = order.revision ? '#' : `calculator.html?draft=${encodeURIComponent(order.id)}`;
    for (const key of detailFields) $(key).value = order[key] ?? '';
    renderStagePicker();
    $('stageSaveState').textContent = ''; $('stageSaveState').classList.remove('error');
    $('legacyNote').hidden = order.pricing !== 'legacy';
    $('menuLines').innerHTML = order.items.map(item => `<li><span>${escape(item.name)}<small>${item.qty} × ${item.price == null ? 'ფასი უცნობია' : money(item.price)}</small></span><span class="money">${item.price == null ? '—' : money(CrmModel.round(item.qty*item.price))}</span></li>`).join('');
    $('menuEmpty').hidden = !!order.items.length;
    $('quoteTotal').textContent = money(order.total);
    $('feesSummary').textContent = `სერვისი ${money(order.serviceFee)} · ტრანსპორტი ${money(order.transportFee)}`;
    $('menuLink').textContent = order.items.length ? 'მენიუს რედაქტირება' : 'მენიუს დამატება';
    $('menuLink').href = `calculator.html?${order.revision ? 'order' : 'draft'}=${encodeURIComponent(order.id)}`;
    $('invoiceLink').href = `calculator.html?order=${encodeURIComponent(order.id)}&invoice=1`;
    $('invoiceLink').hidden = !order.revision || order.total <= 0;
    $('staffLink').href = `staff-sheet.html?order=${encodeURIComponent(order.id)}`;
    $('staffLink').hidden = !order.revision;
    $('deleteBtn').hidden = !order.revision; $('deleteConfirm').hidden = true; $('deleteState').textContent = '';
    $('formFields').disabled = false; $('saveBtn').disabled = false;
    dirty = false; $('saveState').textContent = order.revision ? 'ყველა ცვლილება შენახულია' : 'ჯერ არ არის შენახული';
    updateBalance();
    if (focus) $('clientName').focus();
}
function updateBalance() {
    const phone = $('phone').value.replace(/[^+\d]/g,'');
    $('callPhone').hidden = !phone;
    $('callPhone').href = `tel:${phone}`;
    const value = $('paid').value;
    const balance = value === '' ? null : CrmModel.round(activeOrder.total - Number(value));
    $('balanceLabel').textContent = balance != null && balance < 0 ? 'ზედმეტად გადახდილი' : 'დარჩენილი';
    $('balanceValue').textContent = balance == null ? 'უცნობია' : money(Math.abs(balance));
}
function route(background = false) {
    background = background === true;
    if (saving) { if (!background) history.replaceState(null,'',activeHash); return; }
    if (background && activeOrder && (dirty || !$('deleteConfirm').hidden)) {
        const saved = orders.find(order=>order.id===activeOrder.id);
        if (!activeOrder.revision && saved) {
            notice('ეს მონახაზი უკვე შენახულია. თქვენი ახალი ცვლილებები დარჩა ეკრანზე. შეადარეთ შენახულ შეკვეთას სხვა ფანჯარაში, ან ხელახლა ჩატვირთეთ გვერდი ახალი ცვლილებების გაუქმებისთვის.');
        } else if (activeOrder.revision && connected && (!saved || saved.revision !== activeOrder.revision)) {
            notice('შეკვეთა სხვა ფანჯარაში შეიცვალა ან წაიშალა. თქვენი ცვლილებები დარჩა ეკრანზე. შეადარეთ შენახულ ასლს სხვა ფანჯარაში.');
        }
        return;
    }
    if (!background && dirty && !confirm('ცვლილებები ჯერ არ არის შენახული. გახვიდეთ შენახვის გარეშე?')) {
        history.replaceState(null,'',activeHash); return;
    }
    dirty = false; connectionNotice();
    if (location.hash === '#new') { location.replace('calculator.html'); return; }
    const draftId = new URLSearchParams(location.hash.slice(1)).get('draft');
    if (draftId) {
        const draft = CrmDraft.load(draftId);
        const saved = orders.find(order=>order.id===draftId);
        if (saved && (connected || !draft)) {
            if (connected) CrmDraft.clear(draftId);
            history.replaceState(null,'',`#order=${encodeURIComponent(saved.id)}`); openOrder(saved,!background); return;
        }
        if (draft) { openOrder(draft,!background); return; }
        notice('შეკვეთის მონახაზი აღარ არის ხელმისაწვდომი. გახსენით შენახული შეკვეთა ან დაამატეთ ახალი.', 'error');
    }
    const id = new URLSearchParams(location.hash.slice(1)).get('order');
    if (id) {
        const order = orders.find(item=>item.id===id);
        if (order) { openOrder(order,!background); return; }
        if (connected) notice('შეკვეთა ვერ მოიძებნა. განაახლეთ სია.', 'error');
    }
    activeHash = location.hash; activeOrder = null; $('detailView').hidden = true; $('listView').hidden = false; renderList();
}
async function refresh() {
    const sequence = ++refreshSequence;
    refreshing = true;
    $('refreshBtn').disabled = true;
    connectionNotice();
    if (!activeOrder) renderList();
    try {
        await CrmApi.list();
        if (sequence !== refreshSequence) return;
        orders = CrmApi.cachedOrders(); connected = true; refreshError = '';
    } catch (error) {
        if (sequence !== refreshSequence) return;
        connected = false; refreshError = error.message;
        orders = CrmApi.cachedOrders();
    } finally {
        if (sequence === refreshSequence) {
            refreshing = false; $('refreshBtn').disabled = false;
            connectionNotice();
            const left = window.scrollX, top = window.scrollY;
            route(true);
            window.scrollTo(left,top);
        }
    }
}
$('orderForm').addEventListener('input', event => {
    if (event.target.name === 'orderStage') return saveStage(event.target.value);
    dirty = true; $('saveState').textContent = 'ცვლილებები შესანახია'; updateBalance();
});
$('orderForm').addEventListener('submit', async event => {
    event.preventDefault(); if (saving || !$('deleteConfirm').hidden) return;
    const draft = {...activeOrder};
    for (const key of detailFields) draft[key] = $(key).value;
    try { CrmModel.validate(draft,activeOrder); }
    catch (error) { notice(error.message,'error'); return; }
    saving = true; $('formFields').disabled = true; $('saveBtn').disabled = true; $('deleteBtn').disabled = true; $('saveState').textContent = 'ინახება…'; notice('');
    try {
        const saved = await CrmApi.save(draft);
        if (!activeOrder.revision) CrmDraft.clear(saved.id);
        orders = orders.filter(order=>order.id!==saved.id).concat(saved);
        dirty = false; history.replaceState(null,'',`#order=${encodeURIComponent(saved.id)}`);
        openOrder(saved); notice('შეკვეთა შენახულია.', 'success');
    } catch (error) { notice(error.message,'error'); $('saveState').textContent = 'ვერ შეინახა — თქვენი ცვლილებები დარჩა'; }
    finally { saving = false; $('formFields').disabled = false; $('saveBtn').disabled = false; $('deleteBtn').disabled = false; }
});
$('deleteBtn').addEventListener('click',()=>{
    if(saving || !activeOrder?.revision) return;
    $('deletePrompt').textContent = `წაიშლება შეკვეთა „${activeOrder.name || activeOrder.clientName}“, მისი მენიუ და გადახდის მონაცემები. აპიდან აღდგენა შეუძლებელია.`;
    $('deleteState').textContent = ''; $('deleteConfirm').hidden = false; $('deleteBtn').hidden = true;
    $('formFields').disabled = true; $('saveBtn').disabled = true; $('cancelDeleteBtn').focus();
});
$('cancelDeleteBtn').addEventListener('click',()=>{
    if(saving) return;
    $('deleteConfirm').hidden = true; $('deleteBtn').hidden = false;
    $('formFields').disabled = false; $('saveBtn').disabled = false; $('deleteBtn').focus();
});
$('confirmDeleteBtn').addEventListener('click',async()=>{
    if(saving || !activeOrder?.revision) return;
    saving = true; $('confirmDeleteBtn').disabled = true; $('cancelDeleteBtn').disabled = true; $('deleteState').textContent = 'იშლება…';
    try {
        const deletedId = await CrmApi.remove(activeOrder);
        orders = orders.filter(order=>order.id!==deletedId);
        dirty = false; saving = false; history.replaceState(null,'','#'); route();
        notice('შეკვეთა წაიშალა.','success'); $('newOrder').focus();
    } catch(error) { $('deleteState').textContent = `${error.message} წაშლა ვერ დადასტურდა. შეგიძლიათ სცადოთ ხელახლა.`; }
    finally { saving = false; $('confirmDeleteBtn').disabled = false; $('cancelDeleteBtn').disabled = false; }
});
for(const id of ['menuLink','invoiceLink','staffLink','detailBack']) $(id).addEventListener('click', event=>{
    if(saving || !$('deleteConfirm').hidden){event.preventDefault();return;}
    if(!activeOrder.revision && ['menuLink','detailBack'].includes(id)) {
        const draft={...activeOrder};
        for(const key of detailFields) draft[key]=$(key).value;
        try { CrmDraft.save(draft); dirty=false; }
        catch(error){event.preventDefault();notice(error.message,'error');}
        return;
    }
    if(dirty && id!=='detailBack'){event.preventDefault();notice('ჯერ შეინახეთ ცვლილებები, შემდეგ გახსენით მენიუ, ინვოისი ან სამუშაო ფურცელი.');}
});
$('orderSearch').addEventListener('input', renderList);
$('stageFilter').addEventListener('change', renderList);
$('refreshBtn').addEventListener('click',refresh);
window.addEventListener('hashchange',route);
window.addEventListener('beforeunload',event=>{if(dirty||saving){event.preventDefault();event.returnValue='';}});
route();
refresh();
