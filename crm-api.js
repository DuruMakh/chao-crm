/* The cache contains confirmed saves only. Failed saves stay in the form. */
window.CrmApi = (() => {
    const cacheKey = 'chao_crm_orders_v2', legacyCacheKey = 'chao_crm_orders_v1';
    let pendingSave = null;
    let supportsSchedule = false;
    let memoryCache = { orders: [], deletedIds: [], refreshedAt: null, token: '', available: false }, storageAvailable = true;

    function cachedState() {
        if (storageAvailable) {
            try {
                const stored = JSON.parse(localStorage.getItem(cacheKey) || 'null');
                if (stored && Array.isArray(stored.orders)) return { ...stored, deletedIds: stored.deletedIds || [], available: true };
                const legacy = localStorage.getItem(legacyCacheKey);
                const orders = JSON.parse(legacy || 'null');
                if (Array.isArray(orders)) return { orders, deletedIds: [], refreshedAt: null, token: legacy, available: true };
            } catch { /* A missing or unreadable cache does not prevent online use. */ }
        }
        return memoryCache;
    }

    function cachedOrders() { return cachedState().orders; }

    function legacyToken() {
        try { return localStorage.getItem(legacyCacheKey); } catch { return null; }
    }

    function cacheToken() {
        return JSON.stringify([cachedState().token, legacyToken()]);
    }

    function cache(state) {
        memoryCache = { ...state, token: crypto.randomUUID(), available: true };
        try { localStorage.setItem(cacheKey, JSON.stringify(memoryCache)); }
        catch { storageAvailable = false; /* Keep confirmed data in this page when browser storage is full. */ }
    }

    function updateCache(change) {
        // Serialize the short read/check/write step across tabs; never hold a lock during a request.
        if (window.navigator?.locks) return window.navigator.locks.request(cacheKey, change);
        return Promise.resolve(change());
    }

    function checkSaveConfirmation(order, beforeRequest = false) {
        const state = cachedState(), current = state.orders.find(item => item.id === order.id);
        let error;
        if (state.deletedIds.includes(order.id)) {
            error = new Error('ეს შეკვეთა სხვა ფანჯარაში წაიშალა. თქვენი მონაცემები დარჩა ეკრანზე, მაგრამ წაშლილი შეკვეთა ხელახლა არ შეინახება.');
            error.code = 'ORDER_DELETED';
        } else if (!beforeRequest && current && current.revision > order.revision) {
            error = new Error('შეკვეთა თქვენი შენახვის შემდეგ სხვა ფანჯარაში შეიცვალა. თქვენი ჩანაწერი დარჩა ეკრანზე. გადაამოწმეთ განახლებული შეკვეთა სხვა ფანჯარაში.');
            error.code = 'CONFLICT';
        }
        if (error) throw error;
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
        for (let attempt = 0; attempt < 2; attempt++) {
            const token = cacheToken();
            const result = await request();
            supportsSchedule = result.capabilities?.includes('daily-fees') || false;
            const accepted = await updateCache(() => {
                if (cacheToken() !== token) return false;
                const state = cachedState();
                cache({ orders: result.orders, refreshedAt: new Date().toISOString(),
                    deletedIds: state.deletedIds.filter(id => !result.orders.some(order => order.id === id)) });
                return true;
            });
            if (accepted) return result.orders;
        }
        const error = new Error('სია ჩატვირთვისას შეიცვალა. ნაჩვენებია ბოლო დადასტურებული ასლი. სცადეთ განახლება.');
        error.code = 'REFRESH_SUPERSEDED';
        throw error;
    }

    async function save(order) {
        checkSaveConfirmation(order, true);
        if (order.schedule && !supportsSchedule) {
            const service = await request();
            supportsSchedule = service.capabilities?.includes('daily-fees') || false;
            if (!supportsSchedule) throw new Error('მრავალდღიანი შეკვეთის შესანახად Google-ის სერვისი განახლებას საჭიროებს. თქვენი განრიგი დარჩა ეკრანზე.');
        }
        const fingerprint = JSON.stringify(order);
        if (!pendingSave || pendingSave.fingerprint !== fingerprint) {
            pendingSave = { fingerprint, requestId: crypto.randomUUID() };
        }
        const legacy = legacyToken();
        const result = await request({ method: 'POST', body: JSON.stringify({ action: 'save', version: 2, scheduleVersion: 2, requestId: pendingSave.requestId, order }) });
        if (legacyToken() !== legacy) {
            // An older open page cannot write v2 deletion markers, so confirm its intervening change online.
            const current = (await list()).find(item => item.id === result.order.id);
            if (!current) {
                await updateCache(() => {
                    const state = cachedState();
                    cache({ ...state, deletedIds: [...new Set([...state.deletedIds, result.order.id])] });
                });
            }
        }
        await updateCache(() => {
            checkSaveConfirmation(result.order);
            const state = cachedState();
            const orders = state.orders.filter(item => item.id !== result.order.id);
            orders.push(result.order);
            cache({ ...state, orders });
        });
        checkSaveConfirmation(result.order);
        pendingSave = null;
        return result.order;
    }

    async function remove(order) {
        const result = await request({ method: 'POST', body: JSON.stringify({ action: 'delete', version: 2, orderId: order.id, revision: order.revision }) });
        if (result.deletedId !== order.id) throw new Error('წაშლა ვერ დადასტურდა. სცადეთ ხელახლა.');
        await updateCache(() => {
            const state = cachedState();
            cache({ ...state, orders: state.orders.filter(item => item.id !== result.deletedId),
                deletedIds: [...new Set([...state.deletedIds, result.deletedId])] });
        });
        return result.deletedId;
    }

    return { list, save, remove, cachedOrders, cachedState };
})();
