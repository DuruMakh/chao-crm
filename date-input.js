/* Day-first entry with the browser's calendar and ISO dates for saved orders. */
var DateInput = (() => {
    const calendars = new WeakMap();
    const message = 'მიუთითეთ სწორი თარიღი: დღე.თვე.წელი (მაგ. 23.10.2026).';

    function parse(value) {
        if (!value.trim()) return '';
        const parts = value.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
        if (!parts) return null;
        const iso = `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
        const date = new Date(iso);
        return Number(parts[3]) > 0 && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
    }

    function format(value) { return value ? value.split('-').reverse().join('.') : ''; }

    function set(input, value) {
        input.value = format(value);
        input.setCustomValidity('');
        const calendar = calendars.get(input);
        if (calendar) calendar.value = value || '';
    }

    function attach(input) {
        const label = input.labels[0];
        if (label) label.htmlFor = input.id;
        const wrapper = document.createElement('span');
        wrapper.className = 'date-input';
        input.before(wrapper);
        wrapper.append(input);
        const picker = document.createElement('span');
        picker.className = 'date-picker';
        picker.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>';
        const calendar = document.createElement('input');
        calendar.type = 'date';
        calendar.setAttribute('aria-label', `${label ? label.textContent.trim() : 'თარიღი'}: კალენდარი`);
        picker.append(calendar);
        wrapper.append(picker);
        calendars.set(input, calendar);
        input.addEventListener('input', () => {
            const value = parse(input.value);
            input.setCustomValidity(value === null ? message : '');
            calendar.value = value || '';
        });
        input.addEventListener('change', () => {
            const value = parse(input.value);
            if (value !== null) set(input, value);
        });
        calendar.addEventListener('input', event => {
            event.stopPropagation();
            set(input, calendar.value);
            input.dispatchEvent(new Event('input', {bubbles:true}));
        });
    }

    return {parse, format, set, attach, message};
})();
if (typeof module !== 'undefined') module.exports = DateInput;
else document.querySelectorAll('[data-date-input]').forEach(DateInput.attach);
