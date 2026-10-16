# Consumables store (staff)

The consumables store tracks cleaning supplies and other consumables: what is in the store, what was received, what was issued to (or returned from) each site, and how much each site used.

Open **Operations → Consumables**. The tabs are **Store stock**, **Receive**, **Issue to site**, **Movements**, **Site usage** and **Items**.

## Before you start

- **Business unit:** consumables and sites belong to a business unit. Select the business unit that runs the sites (for example your cleaning business) in the header. If the site list is empty, check the business unit selector first.
- **Units:** use standard units such as **piece**, **litre**, **gallon**, **kg**, **box**, **pack**, **roll**, **bottle**, **carton**, **pair** or **set**. Do not use grams or millilitres — enter the quantity in **kg** or **litre** instead (for example 300 g = 0.3 kg).

## Set up items

1. Go to **Operations → Consumables → Items**.
2. Add an item with **Item code**, **Name**, **Category**, **Unit** and **Minimum level**. Category comes from your category list; if Minimum level is left empty it is saved as 0.
3. Save.

## Receive stock into the store

1. Open **Operations → Consumables → Receive**.
2. Choose the **Item**, **Date**, **Quantity**, **Unit cost** and **Supplier** (from your supplier list).
3. Optional: **Link to expense or bill** — pick the Expense Register entry or Accounts Payable bill you used to buy the stock, so the purchase and the stock movement can be traced to each other. Linking does not create or change the expense.
4. Click **Receive into store**. Store stock goes up, and the item's cost is updated using the weighted average cost.

## Issue to a site, or return from a site

1. Open **Operations → Consumables → Issue to site**.
2. Choose **Issue to site** (store → site) or **Return from site** (site → store) at the top of the form.
3. Select the **Item**, **Date**, **Site** and **Quantity**, and add **Notes** if needed.
4. Click **Issue** or **Return**.

You cannot issue more than is in the store. If you try, DavSuite shows "Not enough stock" with the quantity available — receive stock first.

## Correcting stock (adjustments)

Use an adjustment when a stock count differs from DavSuite (damage, loss, counting error).

1. Open **Operations → Consumables → Movements**.
2. Use **Adjust in** (increases store stock) or **Adjust out** (reduces it). Add a note explaining the reason.

## Movements

**Movements** lists every receive, issue, return and adjustment, with filters for item, site, type and date. Use it to see the full history of an item.

## Site usage

1. Open **Operations → Consumables → Site usage**.
2. Set the period.
3. Review, per site and item, the quantity and value **issued minus returned** — what each site actually used.

## Low stock

Open **Store stock**. Items below their minimum level show **Low Stock**; items with nothing left show **Out of Stock**. Filter or sort by **Status** to see them.
