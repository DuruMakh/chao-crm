# Simple catering CRM: first version

Status: implemented and verified against the deployed Google saving service on 2026-10-19, using one new Google Sheet with Orders and Order items tabs. All 15 existing orders were preserved. The project is named Chao CRM; GitHub Pages publishes its frontend from main. See README.md for the site, connected sheet, setup and verification record.

## Agreed purpose

The user wants the simplest useful CRM for their catering business. They selected tracking each order from its first enquiry through the event, including payments. The existing calculator, menu selection, saved orders, and printable invoices are the starting point.

Sign-in and security work are deferred for approximately two months at the user's request. This design does not add them or schedule future work.

Success means the user can quickly see who contacted them, what event is being planned, its current stage, the quoted price, and the amount still owed, without maintaining a second record elsewhere.

## Recommended approach

Use one searchable order list as the home screen. Opening an order shows its details and gives access to the existing calculator and invoice.

Two alternatives were considered: a board with one column per stage, and separate customer and event sections. A board adds navigation on small screens; separate sections require more record management. The order list is the smallest extension of the current saved-order system and is the recommended first version.

## Everyday workflow

1. Add an enquiry as soon as a customer contacts the business. A menu or price is not required yet.
2. Add the event details and build the quote with the existing calculator.
3. Mark the quote as sent, then mark the order confirmed when the customer agrees.
4. Update the amount paid as payments arrive. The remaining balance updates automatically.
5. Mark the event completed, or cancelled if it will not happen. Keep the record available.

The stage changes are manual. Selecting "Quote sent" records something the user has already done; it does not send a message.

## Screens and information

### Order list

Show client/event name, event date, guest count, stage, quote total, and remaining balance. Include search, a stage filter, and a clear "New enquiry" action. Active orders with upcoming dates appear first, and undated enquiries stay visible. Completed and cancelled orders remain accessible through the filter.

On a phone, the same information uses compact stacked rows instead of a wide table.

### Order details

| Information | Behavior |
| --- | --- |
| Client name | Separate from event name; either name is enough to start an enquiry |
| Event name | Reuses existing order names; optional when the client name is entered |
| Company name / company code | Optional billing details; code is text and keeps leading zeros |
| Email | Optional contact address |
| Contact phone | Optional, with a tap-to-call link when present |
| Event date and time | Optional until known; entered as local event time |
| Location | Optional free text |
| Guests | Optional; shares the calculator's existing guest count |
| Stage | Enquiry, Quote sent, Confirmed, Completed, or Cancelled |
| Notes | Reuses the existing order comment |
| Menu and fees | Managed through the existing calculator |
| Quote total | Calculated from the menu and fees |
| Amount paid | One manually maintained cumulative amount |
| Balance | Quote total minus amount paid; show a credit if overpaid |

Opening the calculator or invoice keeps the connection to the same order. Changing a stage or payment must not change its menu or quote total.

## Existing data and implementation boundaries

- Keep the current HTML, CSS, JavaScript, and Google Sheets setup. No new framework or external service is required by this design.
- Preserve existing saved orders and their IDs, names, notes, quantities, fees, guest counts, and totals. Do not infer event dates, payments, or confirmation from old free-text notes.
- Store orders in the new `Orders` tab and menu lines in `Order items`, connected by stable Order IDs. The original product catalog stays separate. The new workbook is the source for CRM records; the old saved-order sheet remains intact after migration.
- Existing records without CRM fields use Enquiry as their initial stage, with an explicit indication that payment information has not yet been recorded. An unknown historical payment must not be presented as a confirmed unpaid balance.
- New quotes retain their quoted unit prices. Opening a saved order or updating its details must not silently replace its price with current catalog prices. For older orders without historical unit prices, preserve the saved total and make recalculation an explicit action before replacing it.
- Replace delete-then-save editing with an atomic update of both tabs in a new Apps Script service. Verify the deployed script before enabling live updates; do not use deletion as a fallback.
- Collapse duplicated page controls where needed for the new screen, while retaining the existing chosen styling where practical.
- Working assumption: retain Georgian for the working interface and the current displayed business name. English remains the language of project communication. A full rebrand is separate from this workflow change.

## Reliability and verification

Verify enquiry creation without products; saving and reopening full event details; every stage transition; partial and full payments; overpayment display; calculator and invoice totals; and preservation of legacy orders. Test that changing a payment or stage leaves the saved quote unchanged.

Simulate a failed save and confirm that the entered information remains available, an error is shown, and retry does not create another order or delete the existing one. A failed server save must never be presented as successfully saved.

Check desktop and phone layouts, especially order discovery, editing, and returning from the calculator. Use isolated sample data for write tests; existing real orders must not be modified for verification.

## Delivery sequence

1. Extend the saved-order data and editing behavior; verify old orders still load and updates are safe to retry.
2. Add the order list and details, linking the existing calculator and invoice; verify the complete enquiry-to-completion flow.
3. Verify payments, failure recovery, and phone use before treating the CRM as ready for daily work.
