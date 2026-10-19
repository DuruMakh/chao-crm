// Deploy with crm-model.js and enable the Google Sheets advanced service.
var CRM_SPREADSHEET_ID = '1SI6Ah8MjtQ_rw7Ah_DeX0-ism7xP-RnAFUwl7eR2Z6U';

function jsonResponse(value) {
    return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function readCrm() {
    const book = SpreadsheetApp.openById(CRM_SPREADSHEET_ID);
    const ordersSheet = book.getSheetByName('Orders');
    const itemsSheet = book.getSheetByName('Order items');
    if (!ordersSheet || !itemsSheet) CrmModel.fail('SCHEMA', 'შეკვეთების ცხრილი ვერ მოიძებნა.');
    const orderRows = ordersSheet.getDataRange().getValues();
    const itemRows = itemsSheet.getDataRange().getValues();
    if (JSON.stringify(orderRows.shift()) !== JSON.stringify(CrmModel.orderHeaders) || JSON.stringify(itemRows.shift()) !== JSON.stringify(CrmModel.itemHeaders)) {
        CrmModel.fail('SCHEMA', 'ცხრილის სვეტები შეიცვალა. დაუკავშირდით ადმინისტრატორს.');
    }
    for (const row of orderRows) {
        if (row[3] instanceof Date) row[3] = Utilities.formatDate(row[3], book.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
        if (row[4] instanceof Date) row[4] = Utilities.formatDate(row[4], book.getSpreadsheetTimeZone(), 'HH:mm');
    }
    return { orders: CrmModel.fromRows(orderRows, itemRows), ordersSheet, itemsSheet };
}

function doGet() {
    try { return jsonResponse({ success: true, version: 2, orders: readCrm().orders }); }
    catch (error) { return errorResponse(error); }
}

function errorResponse(error) {
    return jsonResponse({ success: false, version: 2, error: { code: error.code || 'SERVER', message: error.code ? error.message : 'ცხრილთან დაკავშირება ვერ მოხერხდა. სცადეთ ხელახლა.' } });
}

function prepareSave(data, orders, now) {
    if (data.version !== 2) CrmModel.fail('UPDATE_REQUIRED', 'განაახლეთ გვერდი ახალი ველების ჩასატვირთად.');
    if (data.action !== 'save' || !data.requestId || !data.order) CrmModel.fail('VALIDATION', 'შენახვის მოთხოვნა არასწორია.');
    const previous = orders.find(order => order.id === data.order.id);
    if (previous && previous.lastRequestId === data.requestId) return { order: previous, changed: false };
    if ((previous ? previous.revision : 0) !== Number(data.order.revision || 0)) {
        CrmModel.fail('CONFLICT', 'ეს შეკვეთა სხვა ფანჯარაში შეიცვალა. თქვენი ჩანაწერი დარჩა ეკრანზე. გადაამოწმეთ განახლებული შეკვეთა სხვა ფანჯარაში.');
    }
    const order = CrmModel.validate(data.order, previous);
    Object.assign(order, { createdAt: previous ? previous.createdAt : now, updatedAt: now,
        revision: previous ? previous.revision + 1 : 1, lastRequestId: data.requestId });
    return { order, changed: true };
}

function prepareDelete(data, orders) {
    if (data.version !== 2) CrmModel.fail('UPDATE_REQUIRED', 'განაახლეთ გვერდი და სცადეთ ხელახლა.');
    if (data.action !== 'delete' || typeof data.orderId !== 'string' || !data.orderId.trim() || !Number.isInteger(data.revision) || data.revision < 1) {
        CrmModel.fail('VALIDATION', 'წაშლის მოთხოვნა არასწორია.');
    }
    const previous = orders.find(order => order.id === data.orderId);
    if (previous && previous.revision !== data.revision) CrmModel.fail('CONFLICT', 'შეკვეთა სხვა ფანჯარაში შეიცვალა. წაშლამდე განაახლეთ და გადაამოწმეთ შეკვეთა.');
    return { deletedId: data.orderId, changed: !!previous };
}

function doPost(event) {
    const lock = LockService.getScriptLock();
    try {
        if (!lock.tryLock(20000)) CrmModel.fail('BUSY', 'სხვა შეკვეთა ინახება. სცადეთ ხელახლა.');
        const data = JSON.parse(event.postData.contents);
        const state = readCrm();
        if (data.action === 'delete') {
            const result = prepareDelete(data, state.orders);
            if (result.changed) {
                state.orders = state.orders.filter(order => order.id !== result.deletedId);
                writeCrm(state);
            }
            return jsonResponse({ success: true, version: 2, deletedId: result.deletedId });
        }
        const result = prepareSave(data, state.orders, new Date().toISOString());
        if (result.changed) {
            const index = state.orders.findIndex(order => order.id === result.order.id);
            if (index === -1) state.orders.push(result.order);
            else state.orders[index] = result.order;
            writeCrm(state);
        }
        return jsonResponse({ success: true, version: 2, order: result.order });
    } catch (error) { return errorResponse(error); }
    finally { if (lock.hasLock()) lock.releaseLock(); }
}

function valueCell(value) {
    if (value == null || value === '') return {};
    return { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value) } };
}

function writeCrm(state) {
    const orderRows = [CrmModel.orderHeaders, ...state.orders.map(CrmModel.toRow)].map((row, index) => ({ values: row.map((value, column) => {
        if (index > 0 && column === 3 && value) return valueCell(Date.parse(value) / 86400000 + 25569);
        return valueCell(value);
    }) }));
    const itemRows = [{ values: CrmModel.itemHeaders.map(valueCell) }];
    for (const order of state.orders) for (const item of order.items) {
        const row = itemRows.length + 1;
        itemRows.push({ values: [order.id, item.name, item.qty, item.price].map(valueCell).concat({
            userEnteredValue: { formulaValue: '=IF(D' + row + '="","",ROUND(C' + row + '*D' + row + ',2))' }
        }) });
    }
    const requests = [];
    const metadata = Sheets.Spreadsheets.get(CRM_SPREADSHEET_ID, { fields: 'sheets(properties(sheetId),tables)' });
    for (const [sheet, rows, width] of [[state.ordersSheet, orderRows, CrmModel.orderHeaders.length], [state.itemsSheet, itemRows, CrmModel.itemHeaders.length]]) {
        const sheetId = sheet.getSheetId();
        if (rows.length > sheet.getMaxRows()) requests.push({ appendDimension: { sheetId, dimension: 'ROWS', length: rows.length - sheet.getMaxRows() } });
        requests.push({ updateCells: { range: { sheetId, startRowIndex: 0, endRowIndex: Math.max(rows.length, sheet.getLastRow()), startColumnIndex: 0, endColumnIndex: width }, rows, fields: 'userEnteredValue' } });
        if (rows.length > 1) {
            const formats = sheet === state.ordersSheet ? [[3,4,'DATE','yyyy-mm-dd'],[9,13,'NUMBER','0.00'],[18,22,'TEXT','@']] : [[3,5,'NUMBER','0.00']];
            for (const [start, end, type, pattern] of formats) requests.push({ repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: rows.length, startColumnIndex: start, endColumnIndex: end }, cell: { userEnteredFormat: { numberFormat: { type, pattern } } }, fields: 'userEnteredFormat.numberFormat' } });
        }
        const sheetMeta = metadata.sheets.find(item => item.properties.sheetId === sheetId);
        for (const table of (sheetMeta.tables || [])) requests.push({ updateTable: { table: { tableId: table.tableId, range: { sheetId, startRowIndex: 0, endRowIndex: Math.max(2, rows.length), startColumnIndex: 0, endColumnIndex: width } }, fields: 'range' } });
    }
    // One atomic request writes both tabs; a failed write cannot leave half an order.
    Sheets.Spreadsheets.batchUpdate({ requests }, CRM_SPREADSHEET_ID);
}
