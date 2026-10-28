/* Shared order rules for the browser, Google Apps Script, and tests. */
var CrmModel = (() => {
    const stages = {
        enquiry: 'მოთხოვნა',
        quoted: 'შეთავაზება გაგზავნილია',
        confirmed: 'დადასტურებული',
        paid: 'გადახდილია',
        completed: 'დასრულებული',
        cancelled: 'გაუქმებული',
    };
    const orderHeaders = ['Order ID', 'Event name', 'Phone', 'Event date', 'Event time', 'Location', 'Guests', 'Stage', 'Notes', 'Service fee (GEL)', 'Transport fee (GEL)', 'Quote total (GEL)', 'Amount paid (GEL)', 'Created at', 'Updated at', 'Revision', 'Last save ID', 'Pricing', 'Client name', 'Company name', 'Company code', 'Email', 'Schedule (JSON)'];
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
        const schedule = scheduleWithFees(order);
        const items = schedule ? scheduleItems(schedule) : order.items;
        const fees = schedule ? scheduleFees(schedule) : order;
        const cents = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.qty, 0);
        return (cents + Math.round(fees.serviceFee * 100) + Math.round(fees.transportFee * 100)) / 100;
    }

    function scheduleWithFees(order) {
        if (!order.schedule) return null;
        const hasServiceFees = order.schedule.some(day => day.serviceFee != null);
        const hasTransportFees = order.schedule.some(day => day.transportFee != null);
        return order.schedule.map((day,index) => ({...day,
            serviceFee: day.serviceFee ?? (!hasServiceFees && index === 0 ? order.serviceFee || 0 : 0),
            transportFee: day.transportFee ?? (!hasTransportFees && index === 0 ? order.transportFee || 0 : 0),
        }));
    }

    function scheduleFees(schedule) {
        return {
            serviceFee: schedule.reduce((sum,day) => sum + Math.round(day.serviceFee * 100), 0) / 100,
            transportFee: schedule.reduce((sum,day) => sum + Math.round(day.transportFee * 100), 0) / 100,
        };
    }

    function dayTotal(day) {
        return total({items:day.services.flatMap(service => service.items),serviceFee:day.serviceFee,transportFee:day.transportFee});
    }

    function balance(order) {
        return order.paid == null ? null : round(order.total - order.paid);
    }

    function validDate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    }

    function validateItems(items, pricing) {
        if (!Array.isArray(items)) fail('VALIDATION', 'მენიუს მონაცემები არასწორია.');
        const names = new Set();
        return items.map(item => {
            const name = text(item.name), qty = Number(item.qty);
            if (!name || names.has(name) || !Number.isInteger(qty) || qty <= 0) fail('VALIDATION', 'შეამოწმეთ მენიუს პროდუქტები და რაოდენობები.');
            names.add(name);
            return { name, qty, price: pricing === 'legacy' && item.price == null ? null : amount(item.price, name) };
        });
    }

    function validateSchedule(schedule) {
        if (!Array.isArray(schedule) || !schedule.length) fail('VALIDATION', 'დაამატეთ ღონისძიების დღე.');
        const ids = new Set(), dates = new Set();
        const uniqueId = value => {
            const id = text(value);
            if (!id || ids.has(id)) fail('VALIDATION', 'განრიგის ჩანაწერი მეორდება.');
            ids.add(id);
            return id;
        };
        const result = schedule.map(day => {
            const id = uniqueId(day.id), date = text(day.date);
            if (!validDate(date)) fail('VALIDATION', 'მიუთითეთ თითოეული დღის სწორი თარიღი.');
            if (dates.has(date)) fail('VALIDATION', 'ეს თარიღი უკვე დამატებულია. კვება იმავე დღეში დაამატეთ.');
            dates.add(date);
            if (!Array.isArray(day.services) || !day.services.length) fail('VALIDATION', 'თითოეულ დღეში დაამატეთ მინიმუმ ერთი კვება.');
            const services = day.services.map(service => {
                const id = uniqueId(service.id), name = text(service.name), time = text(service.time), guests = Number(service.guests);
                if (!name) fail('VALIDATION', 'მიუთითეთ კვების სახელი, მაგალითად ლანჩი ან ყავის შესვენება.');
                if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('VALIDATION', 'მიუთითეთ კვების სწორი დრო.');
                if (!Number.isInteger(guests) || guests < 0) fail('VALIDATION', 'სტუმრების რაოდენობა უნდა იყოს არაუარყოფითი მთელი რიცხვი.');
                return { id, name, time, guests, items: validateItems(service.items, 'snapshot') };
            }).sort((a,b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
            return { id, date, serviceFee: amount(day.serviceFee ?? 0, 'დღის სერვისი'), transportFee: amount(day.transportFee ?? 0, 'დღის ტრანსპორტი'), services };
        }).sort((a,b) => a.date.localeCompare(b.date));
        if (JSON.stringify(result).length > 45000) fail('VALIDATION', 'განრიგი ძალიან დიდია. ღონისძიება რამდენიმე შეკვეთად გაყავით.');
        return result;
    }

    function scheduleItems(schedule) {
        const grouped = new Map();
        for (const day of schedule) for (const service of day.services) for (const item of service.items) {
            const key = JSON.stringify([item.name, item.price]);
            if (!grouped.has(key)) grouped.set(key, { ...item, qty: 0 });
            grouped.get(key).qty += item.qty;
        }
        return [...grouped.values()];
    }

    function scheduleGuests(schedule) {
        return Math.max(0, ...schedule.flatMap(day => day.services.map(service => service.guests)));
    }

    function menuGroups(order) {
        if (!order.schedule) return [{ title: '', items: order.items }];
        return [...order.schedule].sort((a,b) => a.date.localeCompare(b.date)).flatMap(day =>
            [...day.services].sort((a,b) => (a.time || '99:99').localeCompare(b.time || '99:99')).map(service => ({
                title: [day.date ? day.date.split('-').reverse().join('.') : 'თარიღი დასაზუსტებელია', service.time, service.name,
                    service.guests ? `${service.guests} სტუმარი` : 'სტუმრები დასაზუსტებელია'].filter(Boolean).join(' · '), items: service.items,
            })));
    }

    function dateRange(order) {
        const dates = order.schedule ? order.schedule.map(day => day.date).filter(Boolean).sort() : [order.eventDate].filter(Boolean);
        return [...new Set([dates[0], dates[dates.length - 1]])].filter(Boolean).map(date => date.split('-').reverse().join('.')).join(' – ');
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
            items: [], schedule: null,
        };
        if (!order.id || (!order.name && !order.clientName)) fail('VALIDATION', 'შეიყვანეთ კლიენტის ან ღონისძიების სახელი.');
        if (order.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email)) fail('VALIDATION', 'მიუთითეთ სწორი ელფოსტის მისამართი.');
        if (!Object.hasOwn(stages, order.status)) fail('VALIDATION', 'აირჩიეთ შეკვეთის სტატუსი.');
        if (!Number.isInteger(order.guests) || order.guests < 0) fail('VALIDATION', 'სტუმრების რაოდენობა უნდა იყოს მთელი რიცხვი.');
        if (order.eventDate && !validDate(order.eventDate)) {
            fail('VALIDATION', 'მიუთითეთ სწორი ღონისძიების თარიღი.');
        }
        if (order.eventTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(order.eventTime)) fail('VALIDATION', 'მიუთითეთ სწორი დრო.');
        if (!['snapshot', 'legacy'].includes(order.pricing) || !Array.isArray(input.items)) fail('VALIDATION', 'მენიუს მონაცემები არასწორია.');
        if (previous?.schedule && !Object.hasOwn(input, 'schedule')) fail('UPDATE_REQUIRED', 'განაახლეთ გვერდი მრავალდღიანი განრიგის შესანარჩუნებლად.');
        if (input.schedule != null) {
            if (order.pricing === 'legacy') fail('REPRICE_REQUIRED', 'მრავალდღიანი განრიგისთვის ჯერ გადაანგარიშეთ მიმდინარე ფასებით.');
            if (!Array.isArray(input.schedule)) fail('VALIDATION', 'განრიგის მონაცემები არასწორია.');
            order.schedule = validateSchedule(scheduleWithFees(input));
            Object.assign(order, scheduleFees(order.schedule));
            order.items = scheduleItems(order.schedule);
            order.eventDate = order.schedule[0].date;
            order.eventTime = order.schedule[0].services[0].time;
            order.guests = scheduleGuests(order.schedule);
        } else order.items = validateItems(input.items, order.pricing);
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
            order.clientName, order.companyName, order.companyCode, order.email, order.schedule ? JSON.stringify(order.schedule) : ''];
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
                schedule: row[22] ? JSON.parse(row[22]) : null,
            };
        });
    }

    function sortOrders(orders) {
        return [...orders].sort((a, b) => (b.eventDate || '').localeCompare(a.eventDate || '') ||
            (b.eventTime || '').localeCompare(a.eventTime || '') || b.updatedAt.localeCompare(a.updatedAt));
    }

    return { stages, orderHeaders, itemHeaders, round, total, balance, validate, validateSchedule, scheduleWithFees, scheduleFees, dayTotal, scheduleItems, scheduleGuests, menuGroups, dateRange, fromLegacy, toRow, fromRows, sortOrders, fail };
})();

if (typeof module !== 'undefined') module.exports = CrmModel;
