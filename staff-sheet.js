const sheetElement = id => document.getElementById(id);
const orderId = new URLSearchParams(location.search).get('order');
let staffOrder = null, staffFile = null, pdfVersion = 0, sharing = false;
if (orderId) sheetElement('backLink').href = `index.html#order=${encodeURIComponent(orderId)}`;

function detail(id, value) {
    const element = sheetElement(id);
    element.textContent = value || 'დასაზუსტებელია';
    element.classList.toggle('missing', !value);
}

function canShareStaffPdf() {
    try {return !!(staffFile && navigator.share && navigator.canShare && navigator.canShare({files:[staffFile]}));}
    catch {return false;}
}

async function prepareStaffPdf() {
    if (!staffOrder) return;
    const request = ++pdfVersion, order = staffOrder;
    staffFile = null;
    sheetElement('downloadPdfBtn').disabled = true;
    sheetElement('whatsappLink').disabled = true;
    sheetElement('pdfRetryBtn').hidden = true;
    sheetElement('shareHint').hidden = false;
    sheetElement('shareHint').textContent = 'PDF მზადდება…';
    try {
        const fonts = await PdfAssets.load();
        if (request !== pdfVersion) return;
        staffFile = new File([StaffPdf.build(order, fonts)], StaffPdf.filename(order), {type:'application/pdf'});
        sheetElement('downloadPdfBtn').disabled = false;
        const supported = canShareStaffPdf();
        sheetElement('whatsappLink').disabled = !supported || sharing;
        sheetElement('shareHint').textContent = supported
            ? 'გასაზიარებლად აირჩიეთ WhatsApp, ჩატი და გაგზავნეთ PDF.'
            : 'ჩამოტვირთეთ PDF და WhatsApp-ში დოკუმენტად მიამაგრეთ.';
    } catch {
        if (request !== pdfVersion) return;
        sheetElement('shareHint').textContent = 'PDF ვერ მომზადდა. სცადეთ ხელახლა.';
        sheetElement('pdfRetryBtn').hidden = false;
    }
}

function renderStaffSheet(order) {
    const title = order.name || order.clientName;
    document.title = `${title} · სამუშაო ფურცელი`;
    sheetElement('eventName').textContent = title;
    detail('eventDate', CrmModel.dateRange(order));
    detail('eventTime', order.schedule ? 'კვებების მიხედვით' : order.eventTime);
    detail('guests', order.guests ? `${order.schedule ? 'მაქს. ' : ''}${order.guests}` : '');
    detail('location', order.location);
    detail('clientName', order.clientName);
    sheetElement('companyName').textContent = order.companyName || '—';
    detail('phone', order.phone);
    const rows = sheetElement('menuRows');
    rows.replaceChildren();
    for (const group of CrmModel.menuGroups(order)) {
        if (group.title) {
            const row = document.createElement('tr'), heading = document.createElement('th');
            heading.textContent = group.title; heading.colSpan = 2; heading.className = 'menu-group';
            row.append(heading); rows.append(row);
        }
        for (const item of group.items) {
            const row = document.createElement('tr');
            const product = document.createElement('td'), quantity = document.createElement('td');
            product.textContent = item.name;
            quantity.textContent = String(item.qty);
            quantity.className = 'quantity';
            row.append(product, quantity); rows.append(row);
        }
        if (group.title && !group.items.length) {
            const row = document.createElement('tr'), empty = document.createElement('td');
            empty.colSpan = 2; empty.textContent = 'მენიუ ჯერ არ არის დამატებული.';
            row.append(empty); rows.append(row);
        }
    }
    sheetElement('menuTable').hidden = !order.items.length && !order.schedule;
    sheetElement('emptyMenu').hidden = !!order.items.length || !!order.schedule;
    sheetElement('notesSection').hidden = !order.notes;
    sheetElement('notes').textContent = order.notes;
    sheetElement('orderId').textContent = `შეკვეთა: ${order.id}`;
    const updated = new Date(order.updatedAt);
    sheetElement('updatedAt').textContent = Number.isNaN(updated.getTime()) ? '' : 'განახლდა: ' + new Intl.DateTimeFormat('en-GB', {dateStyle:'short',timeStyle:'short',timeZone:'Asia/Tbilisi'}).format(updated);
}

async function loadStaffSheet() {
    ++pdfVersion; staffOrder = null; staffFile = null;
    sheetElement('staffSheet').hidden = true;
    sheetElement('printBtn').disabled = true;
    sheetElement('downloadPdfBtn').disabled = true;
    sheetElement('whatsappLink').disabled = true;
    sheetElement('pdfRetryBtn').hidden = true;
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
        staffOrder = order;
        await prepareStaffPdf();
    } catch(error) {
        sheetElement('loadState').textContent = error.message;
        sheetElement('retryBtn').hidden = false;
    }
}

sheetElement('printBtn').addEventListener('click',()=>window.print());
sheetElement('downloadPdfBtn').addEventListener('click',()=>{
    if (!staffFile) return;
    const url = URL.createObjectURL(staffFile), link = document.createElement('a');
    link.href = url; link.download = staffFile.name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    sheetElement('shareHint').textContent = 'PDF-ის ჩამოტვირთვა დაიწყო. WhatsApp-ში დოკუმენტად მიამაგრეთ.';
});
sheetElement('whatsappLink').addEventListener('click',async()=>{
    if (!canShareStaffPdf() || sharing) return;
    const sharedVersion = pdfVersion;
    sharing = true; sheetElement('whatsappLink').disabled = true;
    try {
        // Prepare before the click so the device can open its file-sharing menu immediately.
        await navigator.share({files:[staffFile]});
        if (sharedVersion === pdfVersion) sheetElement('shareHint').textContent = 'გაგზავნა დაასრულეთ WhatsApp-ში.';
    } catch(error) {
        if (sharedVersion === pdfVersion) sheetElement('shareHint').textContent = error.name === 'AbortError'
            ? 'გაზიარება გაუქმდა.' : 'გაზიარება ვერ გაიხსნა. ჩამოტვირთეთ PDF და WhatsApp-ში დოკუმენტად მიამაგრეთ.';
    } finally {
        sharing = false; sheetElement('whatsappLink').disabled = !canShareStaffPdf();
    }
});
sheetElement('pdfRetryBtn').addEventListener('click',prepareStaffPdf);
sheetElement('retryBtn').addEventListener('click',loadStaffSheet);
loadStaffSheet();
