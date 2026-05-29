// ============================================
// SOFIA CATERING — Saved Orders API
// ============================================
// ეს კოდი ჩასვით Google Sheet-ის Script Editor-ში:
//   Extensions → Apps Script → ჩასვით → Deploy → New Deployment
//
// Deployment Settings:
//   Type: Web app
//   Execute as: Me
//   Who has access: Anyone
// ============================================

const ORDERS_SHEET = 'SavedOrders';

// ── Get or create the SavedOrders sheet ──
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ORDERS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ORDERS_SHEET);
    sheet.appendRow(['ID', 'Name', 'Comment', 'Date', 'Total', 'ItemCount', 'ItemsJSON']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Handle GET requests (list orders) ──
function doGet(e) {
  try {
    return listOrders();
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── Handle POST requests (save / delete) ──
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'save') {
      return saveOrder(data.order);
    } else if (action === 'update') {
      return updateOrder(data.order);
    } else if (action === 'delete') {
      return deleteOrder(data.id);
    }

    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── List all orders ──
function listOrders() {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const orders = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    orders.push({
      id: String(row[0]),
      name: String(row[1]),
      comment: String(row[2] || ''),
      date: String(row[3]),
      total: parseFloat(row[4]) || 0,
      itemCount: parseInt(row[5]) || 0,
      quantitiesByName: safeParseJSON(row[6])
    });
  }

  // Return newest first
  orders.reverse();

  return jsonResponse({ success: true, orders: orders });
}

// ── Save an order ──
function saveOrder(order) {
  const sheet = getOrCreateSheet();

  sheet.appendRow([
    String(order.id),
    String(order.name),
    String(order.comment || ''),
    String(order.date),
    Number(order.total) || 0,
    Number(order.itemCount) || 0,
    JSON.stringify(order.quantitiesByName || {})
  ]);

  return jsonResponse({ success: true, id: order.id });
}

// ── Update an existing order by ID ──
function updateOrder(order) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const targetId = String(order.id);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === targetId) {
      const rowNum = i + 1;
      sheet.getRange(rowNum, 1, 1, 7).setValues([[
        String(order.id),
        String(order.name),
        String(order.comment || ''),
        String(order.date),
        Number(order.total) || 0,
        Number(order.itemCount) || 0,
        JSON.stringify(order.quantitiesByName || {})
      ]]);
      return jsonResponse({ success: true, id: order.id });
    }
  }

  // If not found, save as new
  return saveOrder(order);
}

// ── Delete an order by ID ──
function deleteOrder(id) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const targetId = String(id);

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === targetId) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ success: true });
    }
  }

  return jsonResponse({ success: false, error: 'Order not found' });
}

// ── Helpers ──
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeParseJSON(str) {
  try {
    return JSON.parse(str || '{}');
  } catch (e) {
    return {};
  }
}
