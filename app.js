/* ============================================
   CHAO CRM — ORDER CALCULATOR
   Application Logic
   ============================================ */

// ─────────────────────────────────────────────
// CONFIGURATION — Update this with your Google Sheet ID
// ─────────────────────────────────────────────
const CONFIG = {
    // Replace with your actual Google Sheet ID
    // The Sheet ID is the long string in the URL:
    // https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
    SHEET_ID: '187r1S08xaSedNFxn0h9kR0eBCfa98Cg02homO3MzZZw',

    // Sheet name (tab name at the bottom of Google Sheets). Default is "Sheet1"
    SHEET_NAME: 'Sheet1',

    // Currency symbol
    CURRENCY: '₾',

    // How many decimal places for prices
    DECIMALS: 2,
};

// Build the Google Sheets CSV export URL
function getSheetURL() {
    return `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(CONFIG.SHEET_NAME)}`;
}


// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let products = [];       // { name, price, index, category }
let categories = [];     // ordered list of { name, products[] }
let quantities = {};     // { index: quantity }
let activeViewFilter = 'all'; // 'all' or 'selected'
let serviceFee = 0;
let transportFee = 0;
let peopleCount = 0;
let activeInvoiceType = 'detailed'; // 'summary' or 'detailed'


// ─────────────────────────────────────────────
// DOM REFERENCES
// ─────────────────────────────────────────────
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const productsContainer = document.getElementById('productsContainer');
const productsList = document.getElementById('productsList');
const productsCount = document.getElementById('productsCount');
const emptySearch = document.getElementById('emptySearch');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const filterAllBtn = document.getElementById('filterAllBtn');
const filterSelectedBtn = document.getElementById('filterSelectedBtn');
const totalFooter = document.getElementById('totalFooter');
const totalPrice = document.getElementById('totalPrice');
const totalItems = document.getElementById('totalItems');
const resetBtn = document.getElementById('resetBtn');
const retryBtn = document.getElementById('retryBtn');

// New DOM references for Fees & Invoice
const serviceFeeInput = document.getElementById('serviceFeeInput');
const transportFeeInput = document.getElementById('transportFeeInput');
const peopleCountInput = document.getElementById('peopleCountInput');
const invoiceBtn = document.getElementById('invoiceBtn');

const invoiceModal = document.getElementById('invoiceModal');
const invoiceModalClose = document.getElementById('invoiceModalClose');
const invoiceTypeSummary = document.getElementById('invoiceTypeSummary');
const invoiceTypeDetailed = document.getElementById('invoiceTypeDetailed');
const invoiceNumberInput = document.getElementById('invoiceNumber');
const invoiceDateInput = document.getElementById('invoiceDate');
const invoiceDueDateInput = document.getElementById('invoiceDueDate');
const payerNameInput = document.getElementById('payerName');
const payerIdInput = document.getElementById('payerId');
const summaryControls = document.getElementById('summaryControls');
const summaryDescriptionInput = document.getElementById('summaryDescription');
const summaryQuantityInput = document.getElementById('summaryQuantity');
const summaryDaysInput = document.getElementById('summaryDays');

const prevInvoiceNumber = document.getElementById('prevInvoiceNumber');
const prevInvoiceDate = document.getElementById('prevInvoiceDate');
const prevInvoiceDueDate = document.getElementById('prevInvoiceDueDate');
const prevPayerName = document.getElementById('prevPayerName');
const prevPayerId = document.getElementById('prevPayerId');
const prevInvoiceTable = document.getElementById('prevInvoiceTable');


// ─────────────────────────────────────────────
// CSV PARSER (lightweight, no dependencies)
// ─────────────────────────────────────────────
function parseCSV(text) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (inQuotes) {
            if (char === '"' && next === '"') {
                current += '"';
                i++; // skip escaped quote
            } else if (char === '"') {
                inQuotes = false;
            } else {
                current += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                row.push(current.trim());
                current = '';
            } else if (char === '\n' || (char === '\r' && next === '\n')) {
                row.push(current.trim());
                if (row.some(cell => cell !== '')) rows.push(row);
                row = [];
                current = '';
                if (char === '\r') i++; // skip \n in \r\n
            } else {
                current += char;
            }
        }
    }
    // Last row
    row.push(current.trim());
    if (row.some(cell => cell !== '')) rows.push(row);

    return rows;
}


// ─────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────
async function fetchProducts() {
    showLoading();

    try {
        const url = getSheetURL();
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const csvText = await response.text();
        const rows = parseCSV(csvText);

        if (rows.length < 2) {
            throw new Error('The spreadsheet appears to be empty or has no data rows.');
        }

        // Skip header row (row 0), parse data rows
        // Sheet structure: Col A = name, Col B = misc, Col C (index 2) = price
        products = [];
        categories = [];
        let currentCategory = null;

        for (let i = 1; i < rows.length; i++) {
            const name = (rows[i][0] || '').trim();
            if (!name) continue;

            // Price is in Column C (index 2)
            const priceStr = (rows[i][2] || '').replace(/[^0-9.,]/g, '').replace(',', '.');
            const price = parseFloat(priceStr);

            if (!isNaN(price) && price >= 0) {
                // This is a product row
                const product = { name, price, index: products.length, category: currentCategory };
                products.push(product);
                if (currentCategory) {
                    currentCategory.products.push(product);
                }
            } else {
                // No valid price — treat as category header
                currentCategory = { name, products: [] };
                categories.push(currentCategory);
            }
        }

        if (products.length === 0) {
            throw new Error('No valid products found. Ensure Column A has names and Column B has prices.');
        }

        // Initialize quantities
        quantities = {};
        products.forEach(p => { quantities[p.index] = 0; });

        showProducts();
        applyFiltersAndRender();
        updateTotal();
        return true;

    } catch (err) {
        console.error('Fetch error:', err);
        showError(err.message);
    }
}


// ─────────────────────────────────────────────
// UI STATE MANAGEMENT
// ─────────────────────────────────────────────
function showLoading() {
    loadingState.classList.remove('hidden');
    errorState.classList.add('hidden');
    productsContainer.classList.add('hidden');
    emptySearch.classList.add('hidden');
}

function showError(msg) {
    loadingState.classList.add('hidden');
    errorState.classList.remove('hidden');
    productsContainer.classList.add('hidden');
    emptySearch.classList.add('hidden');
    errorMessage.textContent = msg || 'Please check your connection and try again.';
}

function showProducts() {
    loadingState.classList.add('hidden');
    errorState.classList.add('hidden');
    productsContainer.classList.remove('hidden');
}


// ─────────────────────────────────────────────
// RENDERING
// ─────────────────────────────────────────────

// Track which categories are expanded
const expandedCategories = new Set();

function renderProducts(list, isFiltered) {
    productsList.innerHTML = '';
    emptySearch.classList.add('hidden');

    if (list.length === 0) {
        productsContainer.classList.add('hidden');
        emptySearch.classList.remove('hidden');
        return;
    }

    productsContainer.classList.remove('hidden');
    productsCount.textContent = `${list.length} product${list.length !== 1 ? 's' : ''}`;

    // When not filtered, render with collapsible category groups
    if (!isFiltered && categories.length > 0) {
        let itemIdx = 0;
        categories.forEach(cat => {
            const catProducts = cat.products.filter(p => list.includes(p));
            if (catProducts.length === 0) return;

            const isExpanded = expandedCategories.has(cat.name);

            // Count active items in this category
            const activeCount = catProducts.reduce((sum, p) => {
                return sum + ((quantities[p.index] || 0) > 0 ? 1 : 0);
            }, 0);
            const activeQty = catProducts.reduce((sum, p) => {
                return sum + (quantities[p.index] || 0);
            }, 0);

            // Category group wrapper
            const group = document.createElement('div');
            group.className = `category-group${isExpanded ? ' expanded' : ''}`;
            group.dataset.category = cat.name;

            // Clickable header
            const header = document.createElement('div');
            header.className = 'category-header';
            header.innerHTML = `
                <div class="category-header-left">
                    <svg class="category-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                        <polyline points="9 18 15 12 9 6"/>
                    </svg>
                    <span class="category-name">${escapeHTML(cat.name)}</span>
                    <span class="category-count">${catProducts.length}</span>
                </div>
                <div class="category-header-right">
                    ${activeCount > 0 ? `<span class="category-active-badge">${activeQty} ერთ.</span>` : ''}
                </div>
            `;

            header.addEventListener('click', () => {
                if (expandedCategories.has(cat.name)) {
                    expandedCategories.delete(cat.name);
                    group.classList.remove('expanded');
                } else {
                    expandedCategories.add(cat.name);
                    group.classList.add('expanded');
                }
            });

            group.appendChild(header);

            // Products container (collapsible)
            const productsWrap = document.createElement('div');
            productsWrap.className = 'category-products';

            const productsInner = document.createElement('div');
            productsInner.className = 'category-products-inner';

            catProducts.forEach(product => {
                productsInner.appendChild(createProductCard(product, itemIdx++));
            });

            productsWrap.appendChild(productsInner);
            group.appendChild(productsWrap);
            productsList.appendChild(group);
        });

        // Products without a category
        const uncategorized = list.filter(p => !p.category);
        if (uncategorized.length > 0) {
            uncategorized.forEach(product => {
                productsList.appendChild(createProductCard(product, itemIdx++));
            });
        }
    } else {
        // Filtered — flat list (no accordion)
        list.forEach((product, i) => {
            productsList.appendChild(createProductCard(product, i));
        });
    }
}

function createProductCard(product, animIndex) {
    const qty = quantities[product.index] || 0;
    const subtotal = qty * product.price;
    const card = document.createElement('div');
    card.className = `product-card${qty > 0 ? ' active' : ''}`;
    card.style.animationDelay = `${animIndex * 0.04}s`;
    card.dataset.index = product.index;

    card.innerHTML = `
        <div class="product-info">
            <div class="product-name" title="${escapeHTML(product.name)}">${escapeHTML(product.name)}</div>
            <div class="product-price">
                ${product.unknownPrice ? 'ფასი უცნობია' : CONFIG.CURRENCY + ' ' + product.price.toFixed(CONFIG.DECIMALS)}
                <span class="product-subtotal ${qty > 0 ? 'visible' : ''}" data-subtotal="${product.index}">
                    ${qty > 0 && !product.unknownPrice ? `= ${CONFIG.CURRENCY} ${subtotal.toFixed(CONFIG.DECIMALS)}` : ''}
                </span>
            </div>
        </div>
        <div class="qty-control">
            <button class="qty-btn minus" data-action="minus" data-idx="${product.index}" ${qty <= 0 ? 'disabled' : ''} aria-label="Decrease quantity">−</button>
            <input type="number" class="qty-input" data-idx="${product.index}" value="${qty}" min="0" max="9999" inputmode="numeric" aria-label="Quantity for ${escapeHTML(product.name)}">
            <button class="qty-btn plus" data-action="plus" data-idx="${product.index}" aria-label="Increase quantity">+</button>
        </div>
    `;

    return card;
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}


// ─────────────────────────────────────────────
// QUANTITY UPDATES & TOTAL CALCULATION
// ─────────────────────────────────────────────
function updateQuantity(index, newQty) {
    const idx = parseInt(index);
    newQty = Math.max(0, Math.min(9999, Math.floor(newQty) || 0));
    quantities[idx] = newQty;

    // Update card visual state
    const card = document.querySelector(`.product-card[data-index="${idx}"]`);
    if (card) {
        const subtotalEl = card.querySelector(`[data-subtotal="${idx}"]`);
        const minusBtn = card.querySelector('.qty-btn.minus');
        const input = card.querySelector('.qty-input');
        const product = products[idx];

        if (newQty > 0) {
            card.classList.add('active');
            subtotalEl.classList.add('visible');
            subtotalEl.textContent = `= ${CONFIG.CURRENCY} ${(newQty * product.price).toFixed(CONFIG.DECIMALS)}`;
            minusBtn.disabled = false;
        } else {
            card.classList.remove('active');
            subtotalEl.classList.remove('visible');
            subtotalEl.textContent = '';
            minusBtn.disabled = true;
        }

        if (input.value !== String(newQty)) {
            input.value = newQty;
        }
    }

    updateTotal();
}

function updateTotal() {
    let productsTotal = 0;
    let itemCount = 0;

    products.forEach(p => {
        const qty = quantities[p.index] || 0;
        if (qty > 0) {
            productsTotal += qty * p.price;
            itemCount += qty;
        }
    });

    const total = getCurrentOrderSummary().total;

    // Animate price change
    totalPrice.classList.remove('pop');
    void totalPrice.offsetWidth; // force reflow
    totalPrice.classList.add('pop');

    totalPrice.textContent = `${CONFIG.CURRENCY} ${total.toFixed(CONFIG.DECIMALS)}`;
    totalItems.textContent = `${itemCount} item${itemCount !== 1 ? 's' : ''}`;

    const hasAnyCost = itemCount > 0 || serviceFee > 0 || transportFee > 0;
    if (hasAnyCost) {
        totalFooter.classList.add('has-items');
    } else {
        totalFooter.classList.remove('has-items');
    }
    updateButtonsState();
}


// ─────────────────────────────────────────────
// SEARCH & FILTERING
// ─────────────────────────────────────────────
function applyFiltersAndRender() {
    const query = searchInput.value.trim().toLowerCase();
    searchClear.classList.toggle('visible', query.length > 0);

    let filtered = products;

    // Apply view filter (all vs selected)
    if (activeViewFilter === 'selected') {
        filtered = filtered.filter(p => (quantities[p.index] || 0) > 0);
    }

    // Apply search query filter
    if (query.length > 0) {
        filtered = filtered.filter(p =>
            p.name.toLowerCase().includes(query)
        );
    }

    // Determine if it should be rendered as a flat list
    const isFlat = (query.length > 0) || (activeViewFilter === 'selected');

    // Update empty state text
    const emptySearchText = emptySearch.querySelector('p');
    if (emptySearchText) {
        if (activeViewFilter === 'selected') {
            if (products.some(p => (quantities[p.index] || 0) > 0)) {
                emptySearchText.textContent = 'მონიშნული პროდუქტები არ ემთხვევა ძებნას';
            } else {
                emptySearchText.textContent = 'არჩეული პროდუქტები ცარიელია';
            }
        } else {
            emptySearchText.textContent = 'პროდუქტები არ ემთხვევა ძებნას';
        }
    }

    renderProducts(filtered, isFlat);
    updateButtonsState();
}

function handleSearch() {
    applyFiltersAndRender();
}


// ─────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────

// Delegated click handler for quantity buttons
productsList.addEventListener('click', (e) => {
    const btn = e.target.closest('.qty-btn');
    if (!btn) return;

    const idx = btn.dataset.idx;
    const current = quantities[idx] || 0;

    if (btn.dataset.action === 'plus') {
        updateQuantity(idx, current + 1);
    } else if (btn.dataset.action === 'minus') {
        updateQuantity(idx, current - 1);
    }
});

// Delegated input handler for manual quantity entry
productsList.addEventListener('input', (e) => {
    if (!e.target.classList.contains('qty-input')) return;
    const idx = e.target.dataset.idx;
    const val = parseInt(e.target.value) || 0;
    updateQuantity(idx, val);
});

// Handle blur to clean up empty inputs
productsList.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('qty-input')) return;
    const idx = e.target.dataset.idx;
    e.target.value = quantities[idx] || 0;
});

// Search
searchInput.addEventListener('input', handleSearch);
searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.remove('visible');
    applyFiltersAndRender();
    searchInput.focus();
});

// View Filters
filterAllBtn.addEventListener('click', () => {
    if (activeViewFilter === 'all') return;
    activeViewFilter = 'all';
    filterAllBtn.classList.add('active');
    filterSelectedBtn.classList.remove('active');
    applyFiltersAndRender();
});

filterSelectedBtn.addEventListener('click', () => {
    if (activeViewFilter === 'selected') return;
    activeViewFilter = 'selected';
    filterSelectedBtn.classList.add('active');
    filterAllBtn.classList.remove('active');
    applyFiltersAndRender();
});

// Reset all quantities
resetBtn.addEventListener('click', () => {
    products.forEach(p => { quantities[p.index] = 0; });
    serviceFee = 0;
    transportFee = 0;
    peopleCount = 0;
    serviceFeeInput.value = '';
    transportFeeInput.value = '';
    peopleCountInput.value = '';
    applyFiltersAndRender();
    updateTotal();
    updateButtonsState();
    searchInput.value = '';
    searchClear.classList.remove('visible');
});

// Retry button
retryBtn.addEventListener('click', () => initCalculator());


// ─────────────────────────────────────────────
// SAVED ORDERS — Google Sheets API + LocalStorage Cache
// ─────────────────────────────────────────────
// Saving and loading are handled by calculator-orders.js.

// FEES EVENT LISTENERS
// ─────────────────────────────────────────────
if (serviceFeeInput) {
    serviceFeeInput.addEventListener('input', (e) => {
        serviceFee = parseFloat(e.target.value) || 0;
        updateTotal();
        updateButtonsState();
    });
}
if (transportFeeInput) {
    transportFeeInput.addEventListener('input', (e) => {
        transportFee = parseFloat(e.target.value) || 0;
        updateTotal();
        updateButtonsState();
    });
}
if (peopleCountInput) {
    peopleCountInput.addEventListener('input', (e) => {
        peopleCount = parseInt(e.target.value) || 0;
        if (peopleCount > 0) {
            summaryQuantityInput.value = `${peopleCount} ადამიანი`;
        } else {
            summaryQuantityInput.value = '';
        }
        updateButtonsState();
        if (!invoiceModal.classList.contains('hidden')) {
            updateInvoicePreview();
        }
    });
}

// ─────────────────────────────────────────────
// INVOICE SYSTEM
// ─────────────────────────────────────────────

// Format date to DD.MM.YYYY
function formatDateGeo(dateString) {
    if (!dateString) return '-';
    const parts = dateString.split('-');
    if (parts.length === 3) {
        return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
}

// Generate dynamic invoice preview table
function renderInvoiceTable() {
    const summary = getCurrentOrderSummary();
    const type = activeInvoiceType;
    let tableHTML = '';
    
    if (type === 'summary') {
        const desc = summaryDescriptionInput.value.trim() || 'ფურშეტი';
        const qtyLabel = summaryQuantityInput.value.trim() || '—';
        const days = parseInt(summaryDaysInput.value) || 1;
        const total = summary.total;
        
        tableHTML = `
            <thead>
                <tr>
                    <th>დასახელება</th>
                    <th class="center-col">რაოდენობა</th>
                    <th class="num-col">ერთ. ფასი</th>
                    <th class="center-col">დღე</th>
                    <th class="num-col">თანხა</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>${escapeHTML(desc)}</td>
                    <td class="center-col">${escapeHTML(qtyLabel)}</td>
                    <td class="num-col">-</td>
                    <td class="center-col">${days}</td>
                    <td class="num-col">₾ ${total.toFixed(CONFIG.DECIMALS)}</td>
                </tr>
                <tr class="total-label-row">
                    <td colspan="4">ჯამი (GEL):</td>
                    <td class="num-col">₾ ${total.toFixed(CONFIG.DECIMALS)}</td>
                </tr>
            </tbody>
        `;
    } else {
        // Detailed Mode
        const productsTotal = summary.total - summary.serviceFee - summary.transportFee;
        let rowsHTML = '';
        
        summary.items.forEach((item, idx) => {
            rowsHTML += `
                <tr>
                    <td class="center-col">${idx + 1}</td>
                    <td>${escapeHTML(item.name)}</td>
                    <td class="center-col">${item.qty}</td>
                </tr>
            `;
        });
        
        if (summary.items.length === 0) {
            rowsHTML = `
                <tr>
                    <td colspan="3" class="center-col" style="color: var(--clr-text-muted); font-style: italic;">
                        პროდუქტები არ არის არჩეული
                    </td>
                </tr>
            `;
        }
        
        const total = summary.total;
        
        tableHTML = `
            <thead>
                <tr>
                    <th class="center-col" style="width: 60px;">#</th>
                    <th>დასახელება</th>
                    <th class="center-col" style="width: 150px;">რაოდენობა</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHTML}
                <tr class="total-label-row">
                    <td colspan="2">პროდუქტების ჯამი:</td>
                    <td class="center-col">₾ ${productsTotal.toFixed(CONFIG.DECIMALS)}</td>
                </tr>
                ${serviceFee > 0 ? `
                <tr>
                    <td colspan="2">სერვისი (გაშლა, გაფორმება, მომსახურება, ერთჯერადები):</td>
                    <td class="center-col">₾ ${serviceFee.toFixed(CONFIG.DECIMALS)}</td>
                </tr>` : ''}
                ${transportFee > 0 ? `
                <tr>
                    <td colspan="2">ტრანსპორტირება:</td>
                    <td class="center-col">₾ ${transportFee.toFixed(CONFIG.DECIMALS)}</td>
                </tr>` : ''}
                <tr class="grand-total-row">
                    <td colspan="2">ჯამი (GEL):</td>
                    <td class="center-col">₾ ${total.toFixed(CONFIG.DECIMALS)}</td>
                </tr>
            </tbody>
        `;
    }
    
    prevInvoiceTable.innerHTML = tableHTML;
}

// Update live preview values
function updateInvoicePreview() {
    prevInvoiceNumber.textContent = invoiceNumberInput.value.trim() || 'წინასწარი';
    prevInvoiceDate.textContent = formatDateGeo(invoiceDateInput.value);
    prevInvoiceDueDate.textContent = formatDateGeo(invoiceDueDateInput.value);
    
    prevPayerName.textContent = payerNameInput.value.trim() || '—';
    prevPayerId.textContent = payerIdInput.value.trim() || '—';
    
    renderInvoiceTable();
    InvoiceFiles.prepare();
}

function openInvoiceModal() {
    const summary = getCurrentOrderSummary();
    if (summary.total === 0) {
        showToast('⚠️ ინვოისის შესაქმნელად აირჩიეთ პროდუქტები ან მიუთითეთ სერვისის/ტრანსპორტირების საფასური');
        return;
    }
    
    // Default dates
    const today = new Date();
    const dueDate = new Date();
    dueDate.setDate(today.getDate() + 3);
    
    const formatDateInput = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    
    invoiceDateInput.value = formatDateInput(today);
    invoiceDueDateInput.value = activeCrmOrder.eventDate || formatDateInput(dueDate);
    
    // Use the saved billing details, with the contact as the personal payer.
    payerNameInput.value = activeCrmOrder.companyName || activeCrmOrder.clientName || '';
    payerIdInput.value = activeCrmOrder.companyCode || '';
    
    // Start with a preliminary invoice; the internal order ID is not an invoice number.
    invoiceNumberInput.value = 'წინასწარი';
    
    // Auto fill summary quantity if we have people counts
    if (peopleCount > 0) {
        summaryQuantityInput.value = `${peopleCount} ადამიანი`;

    } else {
        summaryQuantityInput.value = '';
    }
    
    // Show modal
    invoiceModal.classList.remove('hidden');
    
    // Switch UI configuration
    switchInvoiceType('detailed');
}

function closeInvoiceModal() {
    invoiceModal.classList.add('hidden');
}

function switchInvoiceType(type) {
    activeInvoiceType = type;
    invoiceTypeSummary.setAttribute('aria-pressed', type === 'summary');
    invoiceTypeDetailed.setAttribute('aria-pressed', type === 'detailed');
    if (type === 'summary') {
        invoiceTypeSummary.classList.add('active');
        invoiceTypeDetailed.classList.remove('active');
        summaryControls.style.display = '';
    } else {
        invoiceTypeSummary.classList.remove('active');
        invoiceTypeDetailed.classList.add('active');
        summaryControls.style.display = 'none';
    }
    updateInvoicePreview();
}

// INVOICE EVENT LISTENERS
invoiceBtn.addEventListener('click', openInvoiceModal);
invoiceModalClose.addEventListener('click', closeInvoiceModal);

invoiceTypeSummary.addEventListener('click', () => switchInvoiceType('summary'));
invoiceTypeDetailed.addEventListener('click', () => switchInvoiceType('detailed'));

const previewInputs = [
    invoiceNumberInput, invoiceDateInput, invoiceDueDateInput,
    payerNameInput, payerIdInput, summaryDescriptionInput,
    summaryQuantityInput, summaryDaysInput
];
previewInputs.forEach(input => {
    if (input) {
        input.addEventListener('input', updateInvoicePreview);
    }
});

invoiceModal.addEventListener('click', (e) => {
    if (e.target === invoiceModal) closeInvoiceModal();
});


// ─────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => initCalculator());
