/* New orders stay in this browser tab until the details form is saved to Google. */
window.CrmDraft = (() => {
    const key = id => `chao_crm_draft_${id}`;

    function save(order) {
        try { sessionStorage.setItem(key(order.id), JSON.stringify(order)); }
        catch { throw new Error('შეკვეთის გაგრძელება ვერ მოხერხდა. თქვენი მონაცემები დარჩა ეკრანზე. სცადეთ ხელახლა.'); }
        return order;
    }

    function load(id) {
        try { return JSON.parse(sessionStorage.getItem(key(id)) || 'null'); }
        catch { return null; }
    }

    function clear(id) {
        try { sessionStorage.removeItem(key(id)); } catch { /* Google already confirmed the save. */ }
    }

    function create() {
        return save({ id:crypto.randomUUID(), revision:0, name:'',clientName:'',companyName:'',companyCode:'',email:'',phone:'',eventDate:'',eventTime:'',location:'',guests:0,status:'enquiry',notes:'',serviceFee:0,transportFee:0,total:0,paid:0,pricing:'snapshot',items:[] });
    }

    // A new draft filled from the AI's reading of free text; nothing reaches Google until the form is saved.
    function fromParsed(parsed) {
        const { unmatched, ...fields } = parsed;
        const draft = { ...create(), ...fields };
        draft.total = CrmModel.total(draft);
        return save(draft);
    }

    return { create, fromParsed, load, save, clear };
})();
