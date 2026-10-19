# Chao CRM

A small order tracker for Chao Catering using plain HTML, CSS and JavaScript, with Georgian labels.

[Open Chao CRM](https://durumakh.github.io/chao-crm/) · [GitHub repository](https://github.com/DuruMakh/chao-crm)

## Daily workflow

1. Choose **New order** to open the menu calculator. Select quantities, guests and fees, then click **Save** to continue to the details form.
2. Enter the client name and event name in separate fields, plus phone, email, company name/code and event details as needed. At least a client or event name is required. **Save order** writes the complete order to Google Sheets. You can return to the menu without losing the details you entered.
3. Use the icon row above the order details to select Enquiry, Quote sent, Confirmed or Completed; Cancelled sits separately. Hover or keyboard focus shows the stage name, and the selected name stays visible. For existing orders, clicking a stage saves it immediately and shows Saving/Saved beside it. Other unfinished fields stay in the form and still need **Save order**. An unconfirmed save restores the previous confirmed stage and shows an error; select the intended stage again to retry. For a new order, the stage is kept in the local draft until the first **Save order** creates the Google record.
4. Enter the cumulative amount received, including deposits. The remaining balance updates immediately.
5. Open the linked invoice. **დეტალური** (Detailed) is the default each time; choose **შეჯამებული** (Summary) only when needed. Detailed includes saved products and quantities, including for older orders, without changing the saved quote. The company name and code fill the payer details; for individuals, the client name is used. The two footer icons are **Download PDF** and **Share PDF**, with hover and accessibility labels. Download saves directly without a print window. On supported devices, Share opens the device's share menu with the PDF included; choose WhatsApp, the client and Send. When file sharing is unavailable, its icon is disabled. The old explanatory text, manual WhatsApp link, Print and Cancel buttons have been removed; the top-right close button remains.
6. To remove an order, open it, choose **შეკვეთის წაშლა** (Delete order), then confirm. This removes its details, payments and menu lines together. Cancel keeps any unsaved edits. There is no undo button in the app.
7. Open **სამუშაო ფურცელი** (Staff sheet) for the kitchen and waiters, then choose **ბეჭდვა / PDF** to print or save as PDF. It includes products and quantities, event date/start time, guests, location, contact details and notes, without billing columns. Only the event name appears in the header. Tight rows and 10mm A4 margins leave more room for products; longer content continues onto another page without being clipped. Save edits before opening it.
8. On the staff sheet, choose **WhatsApp-ში გაზიარება** (Share on WhatsApp), select a chat and press Send in WhatsApp. It prepares the staff details as text, including notes and product quantities, without billing fields. It does not attach a PDF or send automatically; no WhatsApp Business account or Google setup change is needed. This uses WhatsApp's [documented pre-filled message link](https://faq.whatsapp.com/5913398998672934).

The location field accepts an address or the suggested **თვითგატანა (კლიენტი მოაკითხავს)** (Customer pickup) text. Pickup is stored in the existing Location column. The time field is the event's start time; preparation deadlines or pickup times can be written in Notes. Missing event details are marked as needing confirmation on the staff sheet.

Stages are manual. Changing a stage does not send a message. A blank payment means unknown, whereas zero means no payment recorded. Completed and cancelled orders remain accessible through the list filter.

Invoice PDFs are generated locally in the browser with the Chao logo and embedded Georgian fonts. Invoice data is not uploaded to a PDF conversion service. File sharing uses the browser's [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), so available destinations depend on the browser, device and installed apps. Opening the share menu is not confirmation that a message was sent.

## Storage

[Chao Catering CRM Google Sheet](https://docs.google.com/spreadsheets/d/1SI6Ah8MjtQ_rw7Ah_DeX0-ism7xP-RnAFUwl7eR2Z6U/edit)

- **Orders:** one row per order, including separate event/client names, company name/code, email, event details, stage, quoted total, cumulative payment and revision. Company codes are text so leading zeros remain intact.
- **Order items:** menu lines linked by Order ID, with quantity and the unit price saved when quoted.
- The catalog remains in the original sheet, `187r1S08xaSedNFxn0h9kR0eBCfa98Cg02homO3MzZZw`, tab `Sheet1`. Product names are in column A and prices in column C; rows without a price are category labels.

The initial migration copied 15 existing orders and 202 menu lines, preserving IDs, quantities, fees, notes and recorded totals (25,082.90 GEL combined). Original records were left intact. Old unit prices and payments were not available; they remain blank/unknown. Editing an old menu requires explicit repricing using the current catalog. Merely opening it or changing payment/event details preserves its original quote.

When names were split, the existing combined name column became **Event name**. Client name, company name, company code and email were appended as columns S:V and left blank for existing orders. The app and saving service use API version 2; older open pages must be refreshed before saving.

Use the CRM for normal edits. Do not rename tabs/headers or change IDs and revision columns in the sheet. Sheet edits are not included in the application's conflict detection. The browser cache is only a last confirmed copy, not a second database or offline save queue.

New orders use a temporary draft in the current browser tab to carry the menu into the details form. They appear in Google Sheets and the order list only after the final **Save order** succeeds. Editing an already-saved menu still saves directly to that order.

## Google saving service

Project: [Chao Catering CRM Apps Script](https://script.google.com/home/projects/1eh0jUQ5U6kv050AmgExTWgS3R7J5B-biR9IN5tlaALDLf-X1ar7hqNHl/edit)

The project uses `crm-model.js` and `google-apps-script.js` together (they may be pasted consecutively into Code.gs), with the Google Sheets advanced service enabled. The manifest is in `appsscript.json`.

The saving service was deployed and connected on 2026-10-19. It executes as the owner with **Anyone** access, as explicitly approved for the no-sign-in app. Its **/exec** URL is configured in `crm-config.js`. The original saved-orders endpoint is no longer used by the CRM.

Both tabs are written in one atomic Google Sheets batch. A script lock serializes app saves and deletions, revision checks reject stale editors, and save IDs allow safe retries when a response is lost. A repeated deletion succeeds if that order is already gone. The form is not cleared or marked saved until Google confirms success; a failed deletion keeps the order visible for retrying.

For future service changes, update the Apps Script deployment and verify a save and reload. An empty `apiUrl` intentionally shows a connection error; it never pretends local data was saved online. GitHub Pages publishes the frontend from the root of `main` at `https://durumakh.github.io/chao-crm/`. Merging frontend changes starts the existing Pages deployment; verify its result and the live site after each release. The Google saving service is deployed separately.

## Local preview and checks

No installation or build step is needed. With Node.js installed:

```sh
node tools/preview-server.js
```

Open `http://127.0.0.1:8766`. This uses the real configured Google service.

For isolated browser testing, use:

```sh
node tools/preview-server.js --demo
node --test tests/*.test.js
```

Open the demo at `http://127.0.0.1:8767`. Demo mode substitutes disposable in-memory orders and a small catalog. A visible “Test data only” banner distinguishes it from the real app; it never writes to Google Sheets. Restarting the demo discards its changes.

Verified on 2026-10-19: all 13 automated tests passed; desktop and phone flows, invoices, legacy repricing, failed saves and retries were checked. A temporary order was created through the live browser, given a menu and fees totaling 21 GEL, marked confirmed, and updated with a 7 GEL payment. Reloading retained the quote, event date and 14 GEL balance. The temporary order and its menu line were then removed. A cell-by-cell comparison confirmed that all 15 migrated orders and 202 menu lines remained unchanged.

Contact-field update, 2026-10-19: all 15 tests passed. Live browser checks confirmed separate names, company name/code and email survive saving, reloading and calculator saves; all five fields are searchable, and invoices use the company name/code. The test order was removed. All 16 orders present before this update, including the owner's new enquiry, and 202 menu lines were preserved. The service is Apps Script deployment version 3, using API version 2.

Order deletion update, 2026-10-19: all 21 tests passed, including revision conflicts, last-order deletion, failed writes and retries after a lost response. Browser checks confirmed that cancelling preserves unsaved edits and a failed deletion remains visible for retrying. A temporary live order with one menu line was created and deleted through the CRM; both Google Sheet tabs then matched their pre-test values exactly (16 existing orders and 202 menu lines). The service is now Apps Script deployment version 4, still using API version 2.

Menu-first flow update, 2026-10-19: the 21 existing automated tests passed. Browser checks covered menu-to-details handoff, returning to edit the menu while keeping company details, validation, failed-save retry and editing an already-saved order. A temporary live order with a 14 GEL quote and 4 GEL payment survived reloading with its menu and company details intact. It was removed after verification; both tabs again matched all pre-test values (16 orders and 202 menu lines). This update changes the frontend only; the Google service remains version 4.

Staff-sheet update, 2026-10-19: all 24 tests passed, including logistics, legacy quantities, empty menus and unavailable orders. Browser checks covered the saved-order link, pickup text and multiline notes, the unsaved-change guard, and a read-only view of an existing Google order. No real order values or spreadsheet columns changed. Automatic email and WhatsApp delivery are not configured; recipients, channel and sending time still need to be chosen.

WhatsApp sharing update, 2026-10-19: all 26 tests passed, covering complete Georgian messages, special characters, omitted billing fields, missing details and disabled sharing after a load failure. Desktop and 390px phone layouts were checked. A generic fictional message reached WhatsApp's share preview with its text intact; no recipient was selected and no message was sent. This is a frontend-only change.

Invoice PDF sharing and compact staff-sheet update, 2026-10-19: all 26 tests passed. The invoice's two-step save-and-attach panel was checked in the browser, and WhatsApp displayed the edited test invoice number correctly. The staff sheet's actual print styles were previewed at A4 width: the existing 13-row order used 460px of the available 1,047px height, and a 30-row fixture with notes used 921px, with no horizontal overflow. Chrome's native PDF dialog could not be automated, so no final PDF export or attachment was completed during testing. No real order data changed.

Direct invoice PDF update, 2026-10-19: all 32 automated tests passed, including current-value exports, loading failure/retry, edits during loading, native file sharing and cancellation. A PDF downloaded through Chrome without opening print was checked as a one-page A4 document with the logo, Georgian text, leading-zero company code, bank details and 900 GEL total intact. A 60-product fixture produced three A4 pages with every product and the 1,830 GEL total retained; rendered pages were inspected for clipping and overlaps. Chrome reported native PDF file sharing available. The operating-system share chooser and actual WhatsApp attachment/delivery were not exercised; no message was sent. This replaces the earlier print-based save step and changes only the local frontend.

Invoice controls update, 2026-10-19: all 34 tests passed. The sidebar now has two compact icon actions and no persistent help/status text; errors still provide feedback and failed preparation can be retried. Browser checks confirmed Detailed opens by default, Summary remains selectable, and reopening returns to Detailed. An existing legacy order displayed all 13 menu lines and retained its 1,271.50 GEL total, including 300 GEL service and 50 GEL transport, without repricing or saving. The date inputs fit the sidebar without a horizontal scrollbar.

Order stage controls update, 2026-10-19: the detail form's status dropdown was replaced with a connected icon selector and a separate cancellation option. Native radio controls provide keyboard selection, hover/focus labels and one selected stage at a time. Clicking changes the pending form value; the existing Save order action still confirms the change. Demo browser checks verified click and arrow-key selection, visible labels and a saved Completed stage surviving reload with the quote and payment unchanged. The order-list filter and Google saving service are unchanged.

Automatic stage saving update, 2026-10-19: all 39 tests passed. Stage changes now save immediately using the confirmed order, leaving other unfinished form edits untouched. Controls are locked during the request, the confirmed revision updates on success, and failed requests can be retried without losing edits. New orders retain the stage in their local draft rather than creating incomplete Google records. Demo browser checks confirmed one-click saving and reload, a simulated connection failure restoring the previous stage, successful retry, and a separate readback showing that an unfinished client-name change was not saved with the stage. No real order data was changed during these checks.

Code review follow-up, 2026-10-19: the independent review found one keyboard issue in automatic stage saving: temporarily disabling the form dropped focus from the stage selector. Focus now returns to the selected stage after success or failure, unless the user has moved elsewhere. All 41 automated tests pass. Chrome checks on disposable orders confirmed successive arrow-key saves, focus returning after a simulated failed save, and a successful keyboard retry. No other Critical or Important findings remain in the reviewed stage-saving and invoice scope. Live Google writes, native WhatsApp delivery and PDF visual rendering were not repeated in this review.

## Files

- `index.html`, `crm.js`, `crm.css`: order list, details and payments.
- `calculator.html`, `app.js`, `calculator-orders.js`: existing calculator/invoice linked to CRM orders.
- `invoice-pdf.js`, `invoice-files.js`: direct invoice PDF generation, download and supported device file sharing.
- `vendor/`, `assets/`: pinned PDF libraries, Georgian fonts, Chao logo and license/provenance information.
- `crm-model.js`: shared validation, pricing and sheet mapping.
- `crm-api.js`, `crm-config.js`: confirmed saves and Google connection.
- `crm-draft.js`: temporary new-order drafts shared by the menu and details steps.
- `staff-sheet.html`, `staff-sheet.js`, `staff-sheet.css`: saved-order staff view, WhatsApp sharing and A4 print layout.
- `google-apps-script.js`, `appsscript.json`: Google saving service.
- `menu-generator.html`: existing standalone menu generator.

Sign-in and additional security work are deferred at the owner's request. No new framework or paid database has been added.
