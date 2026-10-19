/* Shared order rules for the browser, Google Apps Script, and tests. */
var CrmModel = (() => {
    const stages = {
        enquiry: 'მოთხოვნა',
        quoted: 'შეთავაზება გაგზავნილია',
        confirmed: 'დადასტურებული',
        completed: 'დასრულებული',
        cancelled: 'გაუქმებული',
    };
    const orderHeaders = ['Order ID', 'Event name', 'Phone', 'Event date', 'Event time', 'Location', 'Guests', 'Stage', 'Notes', 'Service fee (GEL)', 'Transport fee (GEL)', 'Quote total (GEL)', 'Amount paid (GEL)', 'Created at', 'Updated at', 'Revision', 'Last save ID', 'Pricing', 'Client name', 'Company name', 'Company code', 'Email'];
    const itemHeaders = ['Order ID', 'Product', 'Quantity', 'Unit price (GEL)', 'Line total (GEL)'];
    const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    const text = value => String(value == null ? '' : value).trim();

    function fail(code, message) {
        const error = new Error(message);
        error.code = code;
        throw error;
    }

    function amount(value, label) {
        const result = Number(value);
        if (value === null || value === '' || !Number.isFinite(result) || result < 0) {
            fail('VALIDATION', `${label}: მიუთითეთ არაუარყოფითი რიცხვი.`);
        }
        return round(result);
    }

    function total(order) {
        const cents = order.items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.qty, 0);
        return (cents + Math.round(order.serviceFee * 100) + Math.round(order.transportFee * 100)) / 100;
    }

    function balance(order) {
        return order.paid == null ? null : round(order.total - order.paid);
    }

    function validate(input, previous) {
        const order = {
            id: text(input.id), name: text(input.name), phone: text(input.phone),
            clientName: text(input.clientName), companyName: text(input.companyName),
            companyCode: text(input.companyCode), email: text(input.email),
            eventDate: text(input.eventDate), eventTime: text(input.eventTime),
            location: text(input.location), guests: Number(input.guests || 0),
            status: input.status, notes: text(input.notes),
            serviceFee: amount(input.serviceFee, 'სერვისი'),
            transportFee: amount(input.transportFee, 'ტრანსპორტი'),
            paid: input.paid == null || input.paid === '' ? null : amount(input.paid, 'გადახდილი თანხა'),
            pricing: input.pricing || 'snapshot',
            items: [],
        };
        if (!order.id || (!order.name && !order.clientName)) fail('VALIDATION', 'შეიყვანეთ კლიენტის ან ღონისძიების სახელი.');
        if (order.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email)) fail('VALIDATION', 'მიუთითეთ სწორი ელფოსტის მისამართი.');
        if (!Object.hasOwn(stages, order.status)) fail('VALIDATION', 'აირჩიეთ შეკვეთის სტატუსი.');
        if (!Number.isInteger(order.guests) || order.guests < 0) fail('VALIDATION', 'სტუმრების რაოდენობა უნდა იყოს მთელი რიცხვი.');
        if (order.eventDate && (!/^\d{4}-\d{2}-\d{2}$/.test(order.eventDate) || Number.isNaN(Date.parse(order.eventDate)) || new Date(order.eventDate).toISOString().slice(0, 10) !== order.eventDate)) {
            fail('VALIDATION', 'მიუთითეთ სწორი ღონისძიების თარიღი.');
        }
        if (order.eventTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(order.eventTime)) fail('VALIDATION', 'მიუთითეთ სწორი დრო.');
        if (!['snapshot', 'legacy'].includes(order.pricing) || !Array.isArray(input.items)) fail('VALIDATION', 'მენიუს მონაცემები არასწორია.');
        const names = new Set();
        order.items = input.items.map(item => {
            const name = text(item.name);
            const qty = Number(item.qty);
            if (!name || names.has(name) || !Number.isInteger(qty) || qty <= 0) fail('VALIDATION', 'შეამოწმეთ მენიუს პროდუქტები და რაოდენობები.');
            names.add(name);
            return { name, qty, price: order.pricing === 'legacy' && item.price == null ? null : amount(item.price, name) };
        });
        if (order.pricing === 'legacy') {
            if (!previous || previous.pricing !== 'legacy' || JSON.stringify(order.items) !== JSON.stringify(previous.items) || order.serviceFee !== previous.serviceFee || order.transportFee !== previous.transportFee) {
                fail('REPRICE_REQUIRED', 'ძველი მენიუს შესაცვლელად ჯერ გადაანგარიშეთ მიმდინარე ფასებით.');
            }
            order.total = previous.total;
        } else {
            order.total = total(order);
        }
        return order;
    }

    function fromLegacy(source) {
        const quantities = source.quantitiesByName || {};
        return {
            id: String(source.id), name: source.name, phone: '', eventDate: '', eventTime: '', location: '',
            clientName: '', companyName: '', companyCode: '', email: '',
            guests: Number(quantities.__peopleCount || 0), status: 'enquiry', notes: source.comment || '',
            serviceFee: Number(quantities.__serviceFee || 0), transportFee: Number(quantities.__transportFee || 0),
            total: Number(source.total), paid: null, createdAt: source.date, updatedAt: source.date,
            revision: 1, lastRequestId: '', pricing: 'legacy',
            items: Object.entries(quantities).filter(([name, qty]) => !name.startsWith('__') && Number(qty) > 0)
                .map(([name, qty]) => ({ name, qty: Number(qty), price: null })),
        };
    }

    function toRow(order) {
        return [order.id, order.name, order.phone, order.eventDate, order.eventTime, order.location, order.guests,
            order.status, order.notes, order.serviceFee, order.transportFee, order.total, order.paid,
            order.createdAt, order.updatedAt, order.revision, order.lastRequestId, order.pricing,
            order.clientName, order.companyName, order.companyCode, order.email];
    }

    function fromRows(orderRows, itemRows) {
        const grouped = new Map();
        for (const row of itemRows) {
            if (!row[0]) continue;
            const id = String(row[0]);
            if (!grouped.has(id)) grouped.set(id, []);
            grouped.get(id).push({ name: String(row[1]), qty: Number(row[2]), price: row[3] === '' || row[3] == null ? null : Number(row[3]) });
        }
        const ids = new Set();
        return orderRows.filter(row => row[0]).map(row => {
            const id = String(row[0]);
            if (ids.has(id)) fail('DUPLICATE_ID', 'ცხრილში შეკვეთის ნომერი მეორდება.');
            ids.add(id);
            return {
                id, name: String(row[1]), phone: text(row[2]), eventDate: text(row[3]), eventTime: text(row[4]),
                location: text(row[5]), guests: Number(row[6] || 0), status: row[7], notes: text(row[8]),
                serviceFee: Number(row[9] || 0), transportFee: Number(row[10] || 0), total: Number(row[11] || 0),
                paid: row[12] === '' || row[12] == null ? null : Number(row[12]),
                createdAt: String(row[13] || ''), updatedAt: String(row[14] || ''), revision: Number(row[15] || 1),
                lastRequestId: text(row[16]), pricing: row[17] || 'legacy', items: grouped.get(id) || [],
                clientName: text(row[18]), companyName: text(row[19]), companyCode: text(row[20]), email: text(row[21]),
            };
        });
    }

    function sortOrders(orders) {
        return [...orders].sort((a, b) => {
            const archived = order => ['completed', 'cancelled'].includes(order.status) ? 1 : 0;
            return archived(a) - archived(b) || (a.eventDate || '9999').localeCompare(b.eventDate || '9999') ||
                (a.eventTime || '99:99').localeCompare(b.eventTime || '99:99') || b.updatedAt.localeCompare(a.updatedAt);
        });
    }

    return { stages, orderHeaders, itemHeaders, round, total, balance, validate, fromLegacy, toRow, fromRows, sortOrders, fail };
})();

if (typeof module !== 'undefined') module.exports = CrmModel;
