// Deploy with crm-model.js and enable the Google Sheets advanced service.
var CRM_SPREADSHEET_ID = '1SI6Ah8MjtQ_rw7Ah_DeX0-ism7xP-RnAFUwl7eR2Z6U';

function jsonResponse(value) {
    return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function crmTiming(operation) {
    return { operation, outcome: 'error', path: 'none', lockWaitMs: 0, readMs: 0, buildMs: 0, metadataMs: 0, writeMs: 0, responseMs: 0,
        sheetReads: 0, orderRowsRead: 0, itemRowsRead: 0, metadataReads: 0, batchWrites: 0, batchRequests: 0, orderRowsWritten: 0, itemRowsWritten: 0 };
}

function timeCrm(timing, phase, operation) {
    const start = Date.now();
    try { return operation(); }
    finally { if (timing) timing[phase] += Date.now() - start; }
}

function logCrmTiming(timing, start) {
    console.log(JSON.stringify({ event: 'crm_performance', ...timing, totalMs: Date.now() - start }));
}

function readCrm(timing) {
    const book = SpreadsheetApp.openById(CRM_SPREADSHEET_ID);
    const ordersSheet = book.getSheetByName('Orders');
    const itemsSheet = book.getSheetByName('Order items');
    if (!ordersSheet || !itemsSheet) CrmModel.fail('SCHEMA', 'შეკვეთების ცხრილი ვერ მოიძებნა.');
    if (timing) timing.sheetReads++;
    const orderRows = ordersSheet.getDataRange().getValues();
    if (timing) { timing.orderRowsRead = orderRows.length; timing.sheetReads++; }
    const itemRows = itemsSheet.getDataRange().getValues();
    if (timing) timing.itemRowsRead = itemRows.length;
    const headers = orderRows.shift(), hasScheduleColumn = headers.length === CrmModel.orderHeaders.length;
    const expectedHeaders = hasScheduleColumn ? CrmModel.orderHeaders : CrmModel.orderHeaders.slice(0, -1);
    if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders) || JSON.stringify(itemRows.shift()) !== JSON.stringify(CrmModel.itemHeaders)) {
        CrmModel.fail('SCHEMA', 'ცხრილის სვეტები შეიცვალა. დაუკავშირდით ადმინისტრატორს.');
    }
    const orderRowIndexes = new Map();
    for (const [index, row] of orderRows.entries()) {
        if (row[0]) orderRowIndexes.set(String(row[0]), index + 1);
        if (row[3] instanceof Date) row[3] = Utilities.formatDate(row[3], book.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
        if (row[4] instanceof Date) row[4] = Utilities.formatDate(row[4], book.getSpreadsheetTimeZone(), 'HH:mm');
    }
    return { orders: CrmModel.fromRows(orderRows, itemRows), orderRowIndexes, ordersSheet, itemsSheet, hasScheduleColumn };
}

function doGet() {
    const start = Date.now(), timing = crmTiming('list');
    try {
        const state = timeCrm(timing, 'readMs', () => readCrm(timing));
        const response = timeCrm(timing, 'responseMs', () => jsonResponse({ success: true, version: 2, capabilities: ['multi-day', 'daily-fees'], orders: state.orders }));
        timing.outcome = 'success';
        return response;
    } catch (error) { return timeCrm(timing, 'responseMs', () => errorResponse(error)); }
    finally { logCrmTiming(timing, start); }
}

function errorResponse(error) {
    return jsonResponse({ success: false, version: 2, error: { code: error.code || 'SERVER', message: error.code ? error.message : 'ცხრილთან დაკავშირება ვერ მოხერხდა. სცადეთ ხელახლა.' } });
}

function prepareSave(data, orders, now) {
    if (data.version !== 2) CrmModel.fail('UPDATE_REQUIRED', 'განაახლეთ გვერდი ახალი ველების ჩასატვირთად.');
    if (data.action !== 'save' || !data.requestId || !data.order) CrmModel.fail('VALIDATION', 'შენახვის მოთხოვნა არასწორია.');
    const previous = orders.find(order => order.id === data.order.id);
    if ((previous?.schedule || data.order.schedule) && data.scheduleVersion !== 2) CrmModel.fail('UPDATE_REQUIRED', 'მრავალდღიანი შეკვეთის შესაცვლელად განაახლეთ გვერდი.');
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
    const start = Date.now(), timing = crmTiming('save');
    const lock = LockService.getScriptLock();
    try {
        if (!timeCrm(timing, 'lockWaitMs', () => lock.tryLock(20000))) CrmModel.fail('BUSY', 'სხვა შეკვეთა ინახება. სცადეთ ხელახლა.');
        const data = JSON.parse(event.postData.contents);
        const state = timeCrm(timing, 'readMs', () => readCrm(timing));
        if (data.action === 'delete') {
            timing.operation = 'delete';
            const result = timeCrm(timing, 'buildMs', () => prepareDelete(data, state.orders));
            if (result.changed) {
                state.orders = state.orders.filter(order => order.id !== result.deletedId);
                writeCrm(state, timing);
            }
            const response = timeCrm(timing, 'responseMs', () => jsonResponse({ success: true, version: 2, deletedId: result.deletedId }));
            timing.outcome = 'success';
            return response;
        }
        const result = timeCrm(timing, 'buildMs', () => prepareSave(data, state.orders, new Date().toISOString()));
        if (result.changed) {
            const index = state.orders.findIndex(order => order.id === result.order.id);
            if (state.hasScheduleColumn && canWriteOrderRow(state.orders[index], result.order)) {
                writeOrderRow(state, result.order, timing);
            } else {
                if (index === -1) state.orders.push(result.order);
                else state.orders[index] = result.order;
                writeCrm(state, timing);
            }
        }
        const response = timeCrm(timing, 'responseMs', () => jsonResponse({ success: true, version: 2, order: result.order }));
        timing.outcome = 'success';
        return response;
    } catch (error) { return timeCrm(timing, 'responseMs', () => errorResponse(error)); }
    finally {
        if (lock.hasLock()) lock.releaseLock();
        logCrmTiming(timing, start);
    }
}

function valueCell(value) {
    if (value == null || value === '') return {};
    return { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value) } };
}

function orderRowCells(order) {
    return { values: CrmModel.toRow(order).map((value, column) =>
        valueCell(column === 3 && value ? Date.parse(value) / 86400000 + 25569 : value)) };
}

function canWriteOrderRow(previous, order) {
    return previous && previous.pricing === order.pricing && previous.total === order.total &&
        previous.serviceFee === order.serviceFee && previous.transportFee === order.transportFee &&
        JSON.stringify(previous.items) === JSON.stringify(order.items);
}

function writeOrderRow(state, order, timing) {
    const requests = timeCrm(timing, 'buildMs', () => {
        const startRowIndex = state.orderRowIndexes.get(order.id);
        return [{ updateCells: { range: { sheetId: state.ordersSheet.getSheetId(), startRowIndex, endRowIndex: startRowIndex + 1,
            startColumnIndex: 0, endColumnIndex: CrmModel.orderHeaders.length }, rows: [orderRowCells(order)], fields: 'userEnteredValue' } }];
    });
    if (timing) Object.assign(timing, { path: 'row', batchWrites: 1, batchRequests: 1, orderRowsWritten: 1 });
    timeCrm(timing, 'writeMs', () => Sheets.Spreadsheets.batchUpdate({ requests }, CRM_SPREADSHEET_ID));
}

function writeCrm(state, timing) {
    if (timing) { timing.path = 'full'; timing.metadataReads++; }
    const metadata = timeCrm(timing, 'metadataMs', () => Sheets.Spreadsheets.get(CRM_SPREADSHEET_ID, { fields: 'sheets(properties(sheetId),tables)' }));
    const requests = timeCrm(timing, 'buildMs', () => {
        const orderRows = [{ values: CrmModel.orderHeaders.map(valueCell) }, ...state.orders.map(orderRowCells)];
        const itemRows = [{ values: CrmModel.itemHeaders.map(valueCell) }];
        for (const order of state.orders) for (const item of order.items) {
            const row = itemRows.length + 1;
            itemRows.push({ values: [order.id, item.name, item.qty, item.price].map(valueCell).concat({
                userEnteredValue: { formulaValue: '=IF(D' + row + '="","",ROUND(C' + row + '*D' + row + ',2))' }
            }) });
        }
        const requests = [];
        for (const [sheet, rows, width] of [[state.ordersSheet, orderRows, CrmModel.orderHeaders.length], [state.itemsSheet, itemRows, CrmModel.itemHeaders.length]]) {
            const sheetId = sheet.getSheetId();
            const endRowIndex = Math.max(rows.length, sheet.getLastRow());
            if (timing) timing[sheet === state.ordersSheet ? 'orderRowsWritten' : 'itemRowsWritten'] = endRowIndex - 1;
            if (rows.length > sheet.getMaxRows()) requests.push({ appendDimension: { sheetId, dimension: 'ROWS', length: rows.length - sheet.getMaxRows() } });
            if (width > sheet.getMaxColumns()) requests.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: width - sheet.getMaxColumns() } });
            requests.push({ updateCells: { range: { sheetId, startRowIndex: 0, endRowIndex, startColumnIndex: 0, endColumnIndex: width }, rows, fields: 'userEnteredValue' } });
            if (rows.length > 1) {
                const formats = sheet === state.ordersSheet ? [[3,4,'DATE','yyyy-mm-dd'],[9,13,'NUMBER','0.00'],[18,22,'TEXT','@']] : [[3,5,'NUMBER','0.00']];
                for (const [start, end, type, pattern] of formats) requests.push({ repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: rows.length, startColumnIndex: start, endColumnIndex: end }, cell: { userEnteredFormat: { numberFormat: { type, pattern } } }, fields: 'userEnteredFormat.numberFormat' } });
            }
            const sheetMeta = metadata.sheets.find(item => item.properties.sheetId === sheetId);
            for (const table of (sheetMeta.tables || [])) requests.push({ updateTable: { table: { tableId: table.tableId, range: { sheetId, startRowIndex: 0, endRowIndex: Math.max(2, rows.length), startColumnIndex: 0, endColumnIndex: width } }, fields: 'range' } });
        }
        return requests;
    });
    // One atomic request writes both tabs; a failed write cannot leave half an order.
    if (timing) { timing.batchWrites++; timing.batchRequests += requests.length; }
    timeCrm(timing, 'writeMs', () => Sheets.Spreadsheets.batchUpdate({ requests }, CRM_SPREADSHEET_ID));
}
