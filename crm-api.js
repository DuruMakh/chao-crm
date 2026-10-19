/* The cache contains confirmed saves only. Failed saves stay in the form. */
window.CrmApi = (() => {
    const cacheKey = 'chao_crm_orders_v1';
    let pendingSave = null;

    function cachedOrders() {
        try { return JSON.parse(localStorage.getItem(cacheKey) || '[]'); } catch { return []; }
    }

    function cache(orders) {
        try { localStorage.setItem(cacheKey, JSON.stringify(orders)); } catch { /* The server is authoritative. */ }
    }

    async function request(options) {
        const url = window.CRM_CONFIG.apiUrl;
        if (!url) throw new Error('შეკვეთების შენახვის სერვისი ჯერ არ არის დაკავშირებული.');
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error('სერვერთან დაკავშირება ვერ მოხერხდა. სცადეთ ხელახლა.');
        const result = await response.json();
        if (!result.success) {
            const error = new Error(result.error?.message || 'შენახვა ვერ მოხერხდა. სცადეთ ხელახლა.');
            error.code = result.error?.code;
            throw error;
        }
        if (result.version !== 2) throw new Error('შეკვეთების სერვისი განახლებას საჭიროებს.');
        return result;
    }

    async function list() {
        const result = await request();
        cache(result.orders);
        return result.orders;
    }

    async function save(order) {
        const fingerprint = JSON.stringify(order);
        if (!pendingSave || pendingSave.fingerprint !== fingerprint) {
            pendingSave = { fingerprint, requestId: crypto.randomUUID() };
        }
        const result = await request({ method: 'POST', body: JSON.stringify({ action: 'save', version: 2, requestId: pendingSave.requestId, order }) });
        pendingSave = null;
        const orders = cachedOrders().filter(item => item.id !== result.order.id);
        orders.push(result.order);
        cache(orders);
        return result.order;
    }

    async function remove(order) {
        const result = await request({ method: 'POST', body: JSON.stringify({ action: 'delete', version: 2, orderId: order.id, revision: order.revision }) });
        if (result.deletedId !== order.id) throw new Error('წაშლა ვერ დადასტურდა. სცადეთ ხელახლა.');
        cache(cachedOrders().filter(item => item.id !== result.deletedId));
        return result.deletedId;
    }

    return { list, save, remove, cachedOrders };
})();
