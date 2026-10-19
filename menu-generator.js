/* ============================================
   CHAO CRM — MENU GENERATOR
   ძირითადი ლოგიკა
   ============================================ */

// ─── CONFIG ───
const MG_CONFIG = {
  SHEET_ID: '187r1S08xaSedNFxn0h9kR0eBCfa98Cg02homO3MzZZw',
  SHEET_NAME: 'Sheet1',
  CURRENCY: '₾',
  DECIMALS: 2,
};

function getSheetURL() {
  return `https://docs.google.com/spreadsheets/d/${MG_CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(MG_CONFIG.SHEET_NAME)}`;
}

// ─── STATE ───
let sheetProducts = [];
let sheetCategories = [];
let generatedMenus = null;
let activeTier = 'standard';

// ─── CSV PARSER ───
function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') { current += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { current += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ',') { row.push(current.trim()); current = ''; }
      else if (char === '\n' || (char === '\r' && next === '\n')) {
        row.push(current.trim());
        if (row.some(c => c !== '')) rows.push(row);
        row = []; current = '';
        if (char === '\r') i++;
      } else { current += char; }
    }
  }
  row.push(current.trim());
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

// ─── DATA FETCH ───
async function fetchSheetData() {
  const url = getSheetURL();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const csvText = await response.text();
  const rows = parseCSV(csvText);
  if (rows.length < 2) throw new Error('ცარიელი ცხრილი');

  sheetProducts = [];
  sheetCategories = [];
  let currentCategory = null;

  for (let i = 1; i < rows.length; i++) {
    const name = (rows[i][0] || '').trim();
    if (!name) continue;
    const priceStr = (rows[i][2] || '').replace(/[^0-9.,]/g, '').replace(',', '.');
    const price = parseFloat(priceStr);
    if (!isNaN(price) && price >= 0) {
      const product = { name, price, category: currentCategory ? currentCategory.name : null };
      sheetProducts.push(product);
      if (currentCategory) currentCategory.products.push(product);
    } else {
      currentCategory = { name, products: [] };
      sheetCategories.push(currentCategory);
    }
  }
  return sheetProducts;
}

// ─── PRICE LOOKUP ───
function getPrice(productName) {
  const p = sheetProducts.find(sp => sp.name === productName);
  return p ? p.price : 0;
}

// ─── MENU GENERATION ───
function generateMenus(guestCount) {
  const tiers = ['economy', 'standard', 'premium', 'vip'];
  const results = {};

  tiers.forEach(tierKey => {
    const tier = MENU_TIERS[tierKey];
    const mult = TIER_MULTIPLIERS[tierKey];

    // ── Food items grouped by category ──
    const categoryGroups = {};
    const foodItems = [];

    tier.items.forEach(item => {
      const price = getPrice(item.name);
      const category = getCategoryForProduct(item.name, sheetCategories) || 'სხვა';
      const qty = calculateQuantity(guestCount, item.ratio, mult, {
        minQty: item.minQty,
        roundTo: item.roundTo
      });
      const subtotal = price * qty;

      const foodItem = {
        name: item.name,
        price,
        quantity: qty,
        subtotal,
        category
      };
      foodItems.push(foodItem);

      if (!categoryGroups[category]) categoryGroups[category] = [];
      categoryGroups[category].push(foodItem);
    });

    // ── Drinks ──
    const drinkItems = [];
    if (tier.drinks) {
      tier.drinks.forEach(d => {
        const price = getPrice(d.name);
        const qty = calculateQuantity(guestCount, d.ratio, 1.0, {
          minQty: d.minQty,
          roundTo: d.roundTo
        });
        drinkItems.push({
          name: d.name,
          price,
          quantity: qty,
          subtotal: price * qty,
          category: 'უალკოჰოლო სასმელები'
        });
      });
    }

    // ── Boards ──
    const boardItems = [];
    if (tier.boardTypes && tier.boardTypes.length > 0) {
      const boardSizes = calculateBoardSizes(guestCount);
      tier.boardTypes.forEach(bt => {
        const boardType = BOARD_TYPES[bt];
        if (!boardType) return;
        boardSizes.forEach(size => {
          const productName = boardType[size];
          const price = getPrice(productName);
          boardItems.push({
            name: productName,
            price,
            quantity: 1,
            subtotal: price,
            category: 'დაფები',
            isBoard: true
          });
        });
      });
    }

    // ── Totals ──
    const allItems = [...foodItems, ...drinkItems, ...boardItems];
    const totalPrice = allItems.reduce((sum, i) => sum + i.subtotal, 0);
    const totalFoodItems = foodItems.reduce((sum, i) => sum + i.quantity, 0);
    const totalDrinkItems = drinkItems.reduce((sum, i) => sum + i.quantity, 0);

    // ── Ordered category groups for display ──
    const categoryOrder = [
      'კანაპეები', 'ბრუსკეტები', 'ვოლოვანები', 'მჭადი',
      'სენდვიჩები და მინი ბურგერები', 'ცომეული და მინი ღვეზელები',
      'ფრიტური და ხორცეული', 'ბლინები და ქაბაბი',
      'სალათები ჭიქებში', 'აჭარული კერძები',
      'დესერტები', 'ხილი'
    ];
    const orderedGroups = [];
    categoryOrder.forEach(catName => {
      if (categoryGroups[catName] && categoryGroups[catName].length > 0) {
        orderedGroups.push({ name: catName, items: categoryGroups[catName] });
      }
    });
    // Any remaining categories
    Object.keys(categoryGroups).forEach(catName => {
      if (!categoryOrder.includes(catName) && categoryGroups[catName].length > 0) {
        orderedGroups.push({ name: catName, items: categoryGroups[catName] });
      }
    });

    results[tierKey] = {
      tier: tierKey,
      name: tier.name,
      icon: tier.icon,
      description: tier.description,
      color: tier.color,
      categoryGroups: orderedGroups,
      drinkItems,
      boardItems,
      totalPrice,
      totalFoodItems,
      totalDrinkItems,
      itemVariety: foodItems.length,
      pricePerGuest: totalPrice / guestCount,
      piecesPerGuest: totalFoodItems / guestCount
    };
  });

  return results;
}

// ─── CATEGORY ICONS ───
const CATEGORY_ICONS = {
  'კანაპეები': '🍢',
  'ბრუსკეტები': '🥖',
  'ვოლოვანები': '🥧',
  'მჭადი': '🫓',
  'სენდვიჩები და მინი ბურგერები': '🍔',
  'ცომეული და მინი ღვეზელები': '🥐',
  'ფრიტური და ხორცეული': '🍗',
  'ბლინები და ქაბაბი': '🥞',
  'სალათები ჭიქებში': '🥗',
  'აჭარული კერძები': '🫕',
  'დესერტები': '🍰',
  'ხილი': '🍓',
  'დაფები': '🧀',
  'უალკოჰოლო სასმელები': '🥤'
};

// ─── RENDER ───
function renderMenus(menus, guestCount) {
  const container = document.getElementById('menusContainer');
  const placeholder = document.getElementById('placeholder');
  const resultsSection = document.getElementById('resultsSection');

  placeholder.classList.add('hidden');
  resultsSection.classList.remove('hidden');

  // Update guest count display
  document.getElementById('resultsGuestCount').textContent = guestCount;

  // Render tabs
  renderTabs(menus);

  // Render active menu
  renderActiveMenu(menus);
}

function renderTabs(menus) {
  const tabsContainer = document.getElementById('menuTabs');
  tabsContainer.innerHTML = '';

  Object.keys(menus).forEach(tierKey => {
    const menu = menus[tierKey];
    const tab = document.createElement('button');
    tab.className = `menu-tab ${tierKey === activeTier ? 'active' : ''}`;
    tab.dataset.tier = tierKey;
    tab.innerHTML = `
      <span class="tab-icon">${menu.icon}</span>
      <span class="tab-name">${menu.name}</span>
      <span class="tab-price">${MG_CONFIG.CURRENCY}${Math.round(menu.pricePerGuest)}/კაცი</span>
    `;
    tab.addEventListener('click', () => {
      activeTier = tierKey;
      document.querySelectorAll('.menu-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderActiveMenu(menus);
    });
    tabsContainer.appendChild(tab);
  });
}

function renderActiveMenu(menus) {
  const menu = menus[activeTier];
  const content = document.getElementById('menuContent');
  const guestCount = parseInt(document.getElementById('guestInput').value) || 50;

  let html = '';

  // ── Summary header ──
  html += `
    <div class="menu-summary">
      <div class="summary-item">
        <span class="summary-label">სტუმარი</span>
        <span class="summary-value">${guestCount}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">სახეობა</span>
        <span class="summary-value">${menu.itemVariety}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">ცალი/კაცზე</span>
        <span class="summary-value">≈${menu.piecesPerGuest.toFixed(1)}</span>
      </div>
      <div class="summary-item highlight">
        <span class="summary-label">ჯამი</span>
        <span class="summary-value">${MG_CONFIG.CURRENCY} ${menu.totalPrice.toFixed(0)}</span>
      </div>
    </div>
  `;

  // ── Food categories ──
  menu.categoryGroups.forEach(group => {
    const icon = CATEGORY_ICONS[group.name] || '📦';
    const groupTotal = group.items.reduce((s, i) => s + i.subtotal, 0);
    const groupQty = group.items.reduce((s, i) => s + i.quantity, 0);

    html += `
      <div class="category-section">
        <div class="category-title">
          <span>${icon} ${group.name}</span>
          <span class="category-meta">${group.items.length} სახ. · ${groupQty} ცალი · ${MG_CONFIG.CURRENCY}${groupTotal.toFixed(0)}</span>
        </div>
        <div class="items-grid">
    `;

    group.items.forEach(item => {
      html += `
        <div class="menu-item">
          <div class="item-name">${item.name}</div>
          <div class="item-details">
            <span class="item-qty">${item.quantity} ცალი</span>
            <span class="item-unit-price">${MG_CONFIG.CURRENCY}${item.price.toFixed(1)}/ცალი</span>
            <span class="item-subtotal">${MG_CONFIG.CURRENCY}${item.subtotal.toFixed(0)}</span>
          </div>
        </div>
      `;
    });

    html += `</div></div>`;
  });

  // ── Boards ──
  if (menu.boardItems.length > 0) {
    const boardTotal = menu.boardItems.reduce((s, i) => s + i.subtotal, 0);
    html += `
      <div class="category-section">
        <div class="category-title">
          <span>🧀 დაფები</span>
          <span class="category-meta">${menu.boardItems.length} ცალი · ${MG_CONFIG.CURRENCY}${boardTotal.toFixed(0)}</span>
        </div>
        <div class="items-grid">
    `;
    menu.boardItems.forEach(item => {
      html += `
        <div class="menu-item board-item">
          <div class="item-name">${item.name}</div>
          <div class="item-details">
            <span class="item-qty">${item.quantity} ცალი</span>
            <span class="item-subtotal">${MG_CONFIG.CURRENCY}${item.subtotal.toFixed(0)}</span>
          </div>
        </div>
      `;
    });
    html += `</div></div>`;
  }

  // ── Drinks ──
  if (menu.drinkItems.length > 0) {
    const drinkTotal = menu.drinkItems.reduce((s, i) => s + i.subtotal, 0);
    html += `
      <div class="category-section">
        <div class="category-title">
          <span>🥤 უალკოჰოლო სასმელები</span>
          <span class="category-meta">${menu.drinkItems.length} სახ. · ${MG_CONFIG.CURRENCY}${drinkTotal.toFixed(0)}</span>
        </div>
        <div class="items-grid">
    `;
    menu.drinkItems.forEach(item => {
      html += `
        <div class="menu-item drink-item">
          <div class="item-name">${item.name}</div>
          <div class="item-details">
            <span class="item-qty">${item.quantity} ცალი</span>
            <span class="item-unit-price">${MG_CONFIG.CURRENCY}${item.price.toFixed(1)}/ცალი</span>
            <span class="item-subtotal">${MG_CONFIG.CURRENCY}${item.subtotal.toFixed(0)}</span>
          </div>
        </div>
      `;
    });
    html += `</div></div>`;
  }

  // ── Bottom total ──
  html += `
    <div class="total-section">
      <div class="total-row">
        <span>საკვები</span>
        <span>${menu.totalFoodItems} ერთეული</span>
      </div>
      <div class="total-row">
        <span>სასმელები</span>
        <span>${menu.totalDrinkItems} ერთეული</span>
      </div>
      ${menu.boardItems.length > 0 ? `<div class="total-row"><span>დაფები</span><span>${menu.boardItems.length} ცალი</span></div>` : ''}
      <div class="total-row grand-total">
        <span>ჯამი</span>
        <span>${MG_CONFIG.CURRENCY} ${menu.totalPrice.toFixed(2)}</span>
      </div>
      <div class="total-row per-guest">
        <span>1 სტუმარზე</span>
        <span>${MG_CONFIG.CURRENCY} ${menu.pricePerGuest.toFixed(2)}</span>
      </div>
    </div>
  `;

  content.innerHTML = html;
}

// ─── COPY TO CLIPBOARD ───
function copyMenuToClipboard() {
  if (!generatedMenus) return;
  const menu = generatedMenus[activeTier];
  const guestCount = parseInt(document.getElementById('guestInput').value) || 50;

  let text = `═══════════════════════════════\n`;
  text += `🍽️ Chao Catering — ფურშეტი\n`;
  text += `${menu.icon} ${menu.name} მენიუ\n`;
  text += `სტუმრები: ${guestCount}\n`;
  text += `═══════════════════════════════\n\n`;

  menu.categoryGroups.forEach(group => {
    const icon = CATEGORY_ICONS[group.name] || '📦';
    text += `${icon} ${group.name}\n`;
    text += `───────────────────\n`;
    group.items.forEach(item => {
      const nameP = item.name.padEnd(40, ' ');
      text += `  ${nameP} ${item.quantity} ცალი  ${MG_CONFIG.CURRENCY}${item.subtotal.toFixed(0)}\n`;
    });
    text += `\n`;
  });

  if (menu.boardItems.length > 0) {
    text += `🧀 დაფები\n───────────────────\n`;
    menu.boardItems.forEach(item => {
      text += `  ${item.name.padEnd(40, ' ')} ${MG_CONFIG.CURRENCY}${item.subtotal.toFixed(0)}\n`;
    });
    text += `\n`;
  }

  if (menu.drinkItems.length > 0) {
    text += `🥤 სასმელები\n───────────────────\n`;
    menu.drinkItems.forEach(item => {
      text += `  ${item.name.padEnd(40, ' ')} ${item.quantity} ცალი  ${MG_CONFIG.CURRENCY}${item.subtotal.toFixed(0)}\n`;
    });
    text += `\n`;
  }

  text += `═══════════════════════════════\n`;
  text += `ჯამი: ${MG_CONFIG.CURRENCY} ${menu.totalPrice.toFixed(2)}\n`;
  text += `1 სტუმარზე: ${MG_CONFIG.CURRENCY} ${menu.pricePerGuest.toFixed(2)}\n`;
  text += `═══════════════════════════════\n`;

  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 კოპირებულია!');
  }).catch(() => {
    showToast('❌ ვერ დაკოპირდა');
  });
}

// ─── TOAST ───
function showToast(message) {
  const existing = document.querySelector('.mg-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'mg-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2500);
}

// ─── EVENT HANDLERS ───
document.addEventListener('DOMContentLoaded', async () => {
  const guestInput = document.getElementById('guestInput');
  const guestSlider = document.getElementById('guestSlider');
  const generateBtn = document.getElementById('generateBtn');
  const copyBtn = document.getElementById('copyBtn');
  const quickBtns = document.querySelectorAll('.quick-btn');
  const loadingEl = document.getElementById('loadingState');
  const mainContent = document.getElementById('mainContent');
  const errorEl = document.getElementById('errorState');

  // Sync input ↔ slider
  guestInput.addEventListener('input', () => {
    const v = parseInt(guestInput.value) || 20;
    guestSlider.value = Math.min(Math.max(v, 20), 300);
  });
  guestSlider.addEventListener('input', () => {
    guestInput.value = guestSlider.value;
  });

  // Quick buttons
  quickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.value;
      guestInput.value = v;
      guestSlider.value = v;
      quickBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Load sheet data
  try {
    loadingEl.classList.remove('hidden');
    mainContent.classList.add('hidden');
    await fetchSheetData();
    loadingEl.classList.add('hidden');
    mainContent.classList.remove('hidden');
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorEl.querySelector('.error-message').textContent = err.message;
    document.getElementById('retryBtn').addEventListener('click', () => location.reload());
    return;
  }

  // Generate
  generateBtn.addEventListener('click', () => {
    const guestCount = parseInt(guestInput.value);
    if (!guestCount || guestCount < 10) {
      guestInput.classList.add('shake');
      setTimeout(() => guestInput.classList.remove('shake'), 500);
      return;
    }
    generatedMenus = generateMenus(guestCount);
    renderMenus(generatedMenus, guestCount);
    generateBtn.textContent = '🔄 თავიდან გენერირება';

    // Scroll to results
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Copy
  copyBtn.addEventListener('click', copyMenuToClipboard);
});
