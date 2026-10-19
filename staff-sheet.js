const sheetElement = id => document.getElementById(id);
const orderId = new URLSearchParams(location.search).get('order');
if (orderId) sheetElement('backLink').href = `index.html#order=${encodeURIComponent(orderId)}`;

function detail(id, value) {
    const element = sheetElement(id);
    element.textContent = value || 'დასაზუსტებელია';
    element.classList.toggle('missing', !value);
}

function staffMessage(order) {
    const value = input => input || 'დასაზუსტებელია';
    const lines = [
        '*სამუშაო ფურცელი · Chao CRM*',
        order.name || order.clientName,
        `სტატუსი: ${CrmModel.stages[order.status] || 'დასაზუსტებელია'}`,
        '',
        `ღონისძიების თარიღი: ${value(order.eventDate ? order.eventDate.split('-').reverse().join('.') : '')}`,
        `დაწყების დრო: ${value(order.eventTime)}`,
        `სტუმრები: ${value(order.guests)}`,
        `ადგილი / თვითგატანა: ${value(order.location)}`,
        `კლიენტი: ${value(order.clientName)}`,
        `კომპანია: ${order.companyName || '—'}`,
        `საკონტაქტო ტელეფონი: ${value(order.phone)}`,
        '',
        '*პროდუქტები და რაოდენობები*',
        ...(order.items.length ? order.items.map(item => `• ${item.name}: ${item.qty}`) : ['მენიუ ჯერ არ არის დამატებული.']),
    ];
    if (order.notes) lines.push('', '*შენიშვნები*', order.notes);
    lines.push('', `შეკვეთა: ${order.id}`);
    return lines.join('\n');
}

function renderStaffSheet(order) {
    const title = order.name || order.clientName;
    document.title = `${title} · სამუშაო ფურცელი`;
    sheetElement('eventName').textContent = title;
    detail('eventDate', order.eventDate ? order.eventDate.split('-').reverse().join('.') : '');
    detail('eventTime', order.eventTime);
    detail('guests', order.guests ? String(order.guests) : '');
    detail('location', order.location);
    detail('clientName', order.clientName);
    sheetElement('companyName').textContent = order.companyName || '—';
    detail('phone', order.phone);
    const rows = sheetElement('menuRows');
    rows.replaceChildren();
    for (const item of order.items) {
        const row = document.createElement('tr');
        const product = document.createElement('td'), quantity = document.createElement('td');
        product.textContent = item.name;
        quantity.textContent = String(item.qty);
        quantity.className = 'quantity';
        row.append(product, quantity); rows.append(row);
    }
    sheetElement('menuTable').hidden = !order.items.length;
    sheetElement('emptyMenu').hidden = !!order.items.length;
    sheetElement('notesSection').hidden = !order.notes;
    sheetElement('notes').textContent = order.notes;
    sheetElement('orderId').textContent = `შეკვეთა: ${order.id}`;
    const updated = new Date(order.updatedAt);
    sheetElement('updatedAt').textContent = Number.isNaN(updated.getTime()) ? '' : 'განახლდა: ' + new Intl.DateTimeFormat('en-GB', {dateStyle:'short',timeStyle:'short',timeZone:'Asia/Tbilisi'}).format(updated);
}

async function loadStaffSheet() {
    sheetElement('staffSheet').hidden = true;
    sheetElement('printBtn').disabled = true;
    sheetElement('whatsappLink').removeAttribute('href');
    sheetElement('whatsappLink').setAttribute('aria-disabled', 'true');
    sheetElement('whatsappLink').tabIndex = -1;
    sheetElement('shareHint').hidden = true;
    sheetElement('retryBtn').hidden = true;
    sheetElement('loadState').hidden = false;
    sheetElement('loadState').textContent = 'შეკვეთა იტვირთება…';
    try {
        if (!orderId) throw new Error('სამუშაო ფურცლის გასახსნელად აირჩიეთ შენახული შეკვეთა.');
        const order = (await CrmApi.list()).find(item=>item.id===orderId);
        if (!order) throw new Error('შეკვეთა ვერ მოიძებნა. დაბრუნდით შეკვეთების სიაში.');
        renderStaffSheet(order);
        sheetElement('loadState').hidden = true;
        sheetElement('staffSheet').hidden = false;
        sheetElement('printBtn').disabled = false;
        sheetElement('whatsappLink').href = `https://wa.me/?text=${encodeURIComponent(staffMessage(order))}`;
        sheetElement('whatsappLink').removeAttribute('aria-disabled');
        sheetElement('whatsappLink').tabIndex = 0;
        sheetElement('shareHint').hidden = false;
    } catch(error) {
        sheetElement('loadState').textContent = error.message;
        sheetElement('retryBtn').hidden = false;
    }
}

sheetElement('printBtn').addEventListener('click',()=>window.print());
sheetElement('retryBtn').addEventListener('click',loadStaffSheet);
loadStaffSheet();
