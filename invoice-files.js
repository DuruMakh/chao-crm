var InvoiceFiles = (() => {
    const element = id => document.getElementById(id);
    const download = element('invoiceDownloadBtn'), share = element('invoiceSharePdfBtn');
    const status = element('invoiceFileStatus'), retry = element('invoicePdfRetry');
    const libraryPromises = new Map();
    let fontsPromise, timer, currentKey = '', version = 0, file = null, preparing = false, sharing = false;

    function readPreview() {
        const value = id => element(id).textContent.trim();
        const cells = row => [...row.cells].map(cell=>({text:cell.textContent.trim(),span:cell.colSpan,
            align:cell.classList.contains('num-col') ? 'right' : cell.classList.contains('center-col') ? 'center' : 'left'}));
        return {number:value('prevInvoiceNumber'),date:value('prevInvoiceDate'),dueDate:value('prevInvoiceDueDate'),
            payerName:value('prevPayerName'),payerId:value('prevPayerId'),
            supplier:[...document.querySelectorAll('#invoicePaper .invoice-col:not(.text-right) p')].map(p=>p.textContent.trim()),
            head:cells(element('prevInvoiceTable').tHead.rows[0]),
            rows:[...element('prevInvoiceTable').tBodies[0].rows].map(row=>({cells:cells(row),
                total:row.classList.contains('total-label-row') || row.classList.contains('grand-total-row')}))};
    }

    async function loadFonts() {
        if (!fontsPromise) fontsPromise = Promise.all(['NotoSansGeorgian-Regular.ttf','NotoSansGeorgian-Bold.ttf','chao-logo.png'].map(async filename=>{
            const response = await fetch(`assets/${filename}`);
            if (!response.ok) throw new Error('Font download failed');
            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = '';
            for (const byte of bytes) binary += String.fromCharCode(byte);
            return btoa(binary);
        })).then(([normal,bold,logo])=>({normal,bold,logo:`data:image/png;base64,${logo}`})).catch(error=>{fontsPromise=null;throw error;});
        return fontsPromise;
    }

    function loadLibrary(source, ready) {
        if (ready()) return Promise.resolve();
        if (!libraryPromises.has(source)) {
            const script = document.createElement('script');
            script.src = source;
            const promise = new Promise((resolve, reject) => {
                script.onload = () => ready() ? resolve() : reject(new Error('PDF library unavailable'));
                script.onerror = () => reject(new Error('PDF library download failed'));
                document.head.append(script);
            }).catch(error => {
                libraryPromises.delete(source); script.remove(); throw error;
            });
            libraryPromises.set(source, promise);
        }
        return libraryPromises.get(source);
    }

    async function loadLibraries() {
        await loadLibrary('vendor/jspdf.umd.min.js?v=4.2.1', () => !!window.jspdf?.jsPDF);
        await loadLibrary('vendor/jspdf.plugin.autotable.min.js?v=5.0.9', () => typeof window.autoTable === 'function');
    }

    function canShareFile() {
        try {return !!(file && navigator.share && navigator.canShare && navigator.canShare({files:[file]}));}
        catch {return false;}
    }

    function cancel() {
        clearTimeout(timer); timer = null; ++version;
        currentKey = ''; file = null; preparing = false;
        download.disabled = true; share.disabled = true; retry.hidden = true;
    }

    function queue(delay, force=false) {
        const invoice = readPreview(), key = JSON.stringify(invoice);
        if (!force && key === currentKey && (file || preparing)) return;
        clearTimeout(timer); timer = null;
        currentKey = key;
        const request = ++version;
        file = null; preparing = true;
        download.disabled = true; share.disabled = true; retry.hidden = true;
        status.classList.remove('is-error');
        status.textContent = 'PDF მზადდება…';
        if (delay) timer = setTimeout(() => { timer = null; build(invoice, request); }, delay);
        else return build(invoice, request);
    }

    async function build(invoice, request) {
        try {
            const [, fonts] = await Promise.all([loadLibraries(), loadFonts()]);
            if (request !== version) return;
            const bytes = InvoicePdf.build(invoice, fonts);
            file = new File([bytes], InvoicePdf.filename(invoice.number), {type:'application/pdf'});
            const supported = canShareFile();
            share.disabled = !supported || sharing;
            share.title = supported ? 'PDF-ის გაზიარება' : 'ამ ბრაუზერში PDF-ის გაზიარება მიუწვდომელია';
            download.disabled = false;
            status.textContent = 'PDF მზადაა.';
        } catch {
            if (request !== version) return;
            status.textContent = 'PDF ვერ მომზადდა. სცადეთ ხელახლა.';
            status.classList.add('is-error');
            retry.hidden = false;
        } finally {
            if (request === version) preparing = false;
        }
    }

    function prepare(force=false) { return queue(0, force); }
    function schedule() { queue(250); }

    download.addEventListener('click',()=>{
        if (!file) return;
        const url = URL.createObjectURL(file), link = document.createElement('a');
        link.href = url; link.download = file.name;
        document.body.append(link); link.click(); link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
        status.textContent = 'PDF-ის ჩამოტვირთვა დაიწყო.';
    });
    share.addEventListener('click',async()=>{
        if (!canShareFile() || sharing) return;
        const sharedVersion = version;
        sharing = true; share.disabled = true;
        status.classList.remove('is-error');
        try {
            // The file is prepared in advance, so this call retains the user's click activation.
            await navigator.share({files:[file],title:file.name});
            if (sharedVersion === version) status.textContent = 'გაგზავნა დაასრულეთ არჩეულ აპში.';
        } catch(error) {
            if (sharedVersion === version) {
                status.textContent = error.name === 'AbortError' ? 'გაზიარება გაუქმდა.' : 'გაზიარება ვერ გაიხსნა. ჩამოტვირთეთ PDF.';
                status.classList.toggle('is-error', error.name !== 'AbortError');
            }
        } finally {
            sharing = false; share.disabled = !canShareFile();
        }
    });
    retry.addEventListener('click',()=>prepare(true));
    return {prepare, schedule, cancel};
})();
