**DAVORS FACILITIES MANAGEMENT SERVICES LTD**

ERP System

**COMPREHENSIVE USER HANDBOOK**

**For Customer Use**

Version 2.8 | September 2026

*Covers: Getting Started · Bulk Import · User Roles (incl. Director) ·
Business Units · Finance (incl. Budget, Tax Settings, Client Receipts) ·
Sales & CRM (Pipeline, Product Quotes, Client Quotations, Returns &
Credit Notes, Discounts & Loyalty, Targets & Commissions) · Point of
Sale · Email & Promotions · HR Management · Operations (incl. Duty
Roster Approvals) · Inventory (Production & Purchasing, Stock
Adjustments) · Real Estate (Davors platform) · Reports · Administration
· Your Subscription*

# **Table of Contents**

1\. Welcome

2\. Getting Started

3\. Understanding User Roles

4\. How Everything Fits Together

5\. The Dashboard

6\. Finance

7\. Sales & CRM (including Point of Sale)

8\. HR Management

9\. Operations

10\. Inventory (Production & Purchasing)

10A\. Real Estate (Davors platform)

11\. Self-Service

12\. Reports

13\. Administration

14\. Your Subscription

15\. Data Security & Privacy

16\. Getting Help

17\. Worked Example --- A Day in Your Business

18\. Glossary of Terms

19\. AI Assistant

# **Section 1 --- Welcome**

Welcome to the Davors Facilities ERP --- a single system for managing
your finances, people, operations, sales, and inventory. This handbook
walks you through every part of your workspace, from your first login to
running reports at month end, and explains the business logic behind the
numbers so you always understand what you are looking at.

Your workspace is private to your organization. Everything you enter ---
employees, customers, transactions, and settings --- is visible only to
your own team, never to any other company using the platform.

+-----------------------------------------------------------------------+
| **Note**                                                              |
|                                                                       |
| This handbook covers the features available in your workspace today.  |
| New modules are added periodically --- check with your account        |
| administrator if you are looking for something not covered here.      |
+-----------------------------------------------------------------------+

# **Section 2 --- Getting Started**

## **2.1 Signing Up**

New organizations sign up at the Davors Facilities ERP landing page by
selecting \"Sign up for free.\" You will be asked for your company name
and an administrator email and password. Once submitted, your workspace
is created immediately with a 90-day free trial giving full access to
your workspace's available features.

## **2.2 Logging In and Your First Session**

  **Step**   **What to do**
  ---------- ----------------------------------------------------------------
  1          Go to your workspace's login page and enter your email and
             password.

  2          If you have forgotten your password, ask your workspace
             administrator to reset it for you from Administration → User
             Accounts.

  3          New accounts must confirm their email address before their first
             login --- check your inbox for a confirmation link after signing
             up.

  4          After logging in you will land on your Dashboard. The left-hand
             sidebar gives you access to every module you have permission to
             use.

+-----------------------------------------------------------------------+
| **Tip**                                                               |
|                                                                       |
| Which modules you see in the sidebar depends on your assigned role    |
| --- see Section 3.                                                    |
+-----------------------------------------------------------------------+

## **2.3 Getting Your Data In --- Two Ways to Start**

Every new workspace starts empty. There are two ways to fill it, and you
are not locked into either one --- most workspaces end up using both.

-   **Starting fresh.** build up your Customers, Employees, and Products
    one at a time as you actually need them --- the natural approach if
    you are new to running things digitally, or your records were never
    that organized to begin with.

-   **Migrating from another platform.** if you already track this
    information in Excel or another system, use Bulk Import (Section
    2.4) to bring your existing spreadsheets in at once, instead of
    retyping everything by hand.

+-----------------------------------------------------------------------+
| **Tip**                                                               |
|                                                                       |
| You can mix both approaches freely --- bulk import your existing      |
| customer list on day one, then keep adding new customers one at a     |
| time as they come in.                                                 |
+-----------------------------------------------------------------------+

## **2.4 Bulk Importing Your Existing Data**

If you are migrating from Excel, another system, or paper records, Bulk
Import lets you upload a spreadsheet and load many records at once,
instead of typing each one in by hand. Look for a Bulk Import button on
the list page of any of the following:

-   **Finished Products.** Finished Products --- Inventory.

-   **Services.** Services --- Sales & CRM.

-   **Employees.** Employee Directory --- HR Management.

-   **Customers.** Customer List --- Sales & CRM.

-   **Expenses.** Expense Register --- Finance.

-   **Fixed Assets.** Fixed Assets --- Finance.

Every Bulk Import follows the same four steps, whichever type of record
you are loading:

-   **1. Upload.** Choose what you are importing and upload your file
    (.csv or .xlsx). An Expected Columns panel on the same screen lists
    exactly which columns to include, which are required, and an example
    value for each --- check this before you upload if you are building
    your file from scratch.

-   **2. Map Columns.** Match each column in your file to the correct
    field in the system. Column order and header names do not need to
    match exactly --- you choose what maps to what, or mark a column to
    be ignored.

-   **3. Validate.** The system checks every row and reports back: rows
    with a genuine problem (a missing required field, an invalid value)
    appear under Rows to Fix and must be corrected before you can
    proceed. Rows with only a soft warning --- for example, a possible
    duplicate --- appear separately under Rows to Review; these are
    still valid and will still import, the warning is just there so you
    notice.

-   **4. Commit.** Once your file shows zero errors, Commit Import
    writes every valid row into the system in one go, and takes you to
    the real list so you can see your data has landed.

+-----------------------------------------------------------------------+
| **Tip**                                                               |
|                                                                       |
| Some fields --- like a product's Supplier, or an employee's         |
| Department or Position --- are matched by name, not by any internal   |
| code. If a name in your file does not already exist in your           |
| workspace, most of these are created automatically so your import is  |
| not blocked; a few, like Payment Method, must already exist in your   |
| settings first, and the Expected Columns panel tells you which is     |
| which.                                                                |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| **Note**                                                              |
|                                                                       |
| ID numbers such as an Employee ID, Client ID, or Asset ID are always  |
| generated by the system, not read from your file --- leave these      |
| columns out of your spreadsheet entirely.                             |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| **Warning**                                                           |
|                                                                       |
| If you accidentally upload and commit the same file twice, the system |
| recognizes the repeat and warns you before proceeding --- but always  |
| check your list screen after an import to confirm the count of new    |
| records matches what you expected.                                    |
+-----------------------------------------------------------------------+



# **Section 3 --- Understanding User Roles**

Every user in your workspace is assigned exactly one role. Your role
determines which modules and actions you can see and use. Roles are set
by your workspace administrator under Administration → User Accounts.

  **Role**           **Typical use**       **Access level**
  ------------------ --------------------- ------------------------------
  Admin              Business owner /      Full access to all modules and
  (super_admin)      manager               settings in your workspace

  Director           Senior manager        Finance, HR Management,
                                           Operations, Real Estate
                                           (Davors only), Reports

  Finance            Accountant /          Finance, Sales & CRM, Reports
                     bookkeeper            

  HR                 HR / payroll officer  HR Management, Sales & CRM,
                                           Reports

  Operations Manager Site / operations     Operations, Inventory, Reports
                     lead                  

  Supervisor         Site supervisor       Operations at assigned sites,
                                           limited HR

  Sales Rep          Sales / till staff    Point of Sale, own sales
                                           records

  Employee           General staff         Self-Service only (payslips,
                                           leave requests)

  Client             Your own customer     Their own invoices/statements
                                           only, via Customer Portal

+-----------------------------------------------------------------------+
| **Note**                                                              |
|                                                                       |
| Only Davors Facilities platform administrators can access Platform    |
| Settings and Monitoring & Support --- these are not part of a         |
| customer workspace.                                                   |
+-----------------------------------------------------------------------+

# **Section 4 --- How Everything Fits Together**

Before diving into each module, it helps to see the whole picture. Your
Dashboard sits at the centre --- every other module feeds it live
figures, and every module is reachable from the sidebar based on your
role.

*Fig. 1 --- Every module ultimately reports back to your Dashboard.*

A quick orientation to each module, with the section that covers it in
full:

-   Finance (Section 6) --- your money: income, expenses, budget,
    statements, invoices

-   Sales & CRM + POS (Section 7) --- your customers and how you sell to
    them

-   HR Management (Section 8) --- your people and payroll

-   Operations (Section 9) --- your sites, work orders, and inspections

-   Inventory (Section 10) --- your stock, whether made or bought, by
    business unit where you use more than one

-   Real Estate (Section 10A) --- landlords, properties, leases, and
    rent (Davors platform staff only)

-   Self-Service (Section 11) --- what every individual staff user sees
    for themselves

-   Reports (Section 12) --- exportable views across every module above

-   Administration (Section 13) --- how the workspace itself is
    configured, including Business Units and billing

Many workspaces also use **Business Units** (Section 10.0 and Section
13) so one company can keep several businesses --- for example Davors
Facilities and Davors Logistics --- under the same login, with stock and
costs kept separate per business.

# **Section 5 --- The Dashboard**

The Dashboard is your home screen and gives an at-a-glance summary
calculated live from your registers. Use the \"Summary Month\" selector
at the top right to view any past month.

## **What you'll see**

-   Net Profit (Year to Date) and Net Profit for the selected month

-   Total Revenue and Total Expenses for the selected month

-   Total Purchases (Month) and Total Purchases (Year to Date) ---
    broken down into Raw Material Purchases, Product Purchases, and a
    Combined Total

-   Cash Position as of the selected month

-   Balance Sheet Check --- confirms your books are balanced

-   Revenue, Expenses & Net Profit chart for the last 6 months

-   Cash and Cash Equivalents chart for the last 6 months

-   Payroll Status and other operational summaries, depending on your
    role

-   **Top Spending / Earning Analysis** --- pick Month or Year, then
    toggle between By Category and By Individual Item, to see your top
    10 expenses and top 10 income sources for that period, ranked
    highest to lowest.

-   **Top Sales Analysis** --- the same Month/Year view for your sales
    activity, toggled between By Product and By Customer, showing your
    top 10 for the period.

+-----------------------------------------------------------------------+
| **Note**                                                              |
|                                                                       |
| Total Purchases is purely informational --- it shows how much you     |
| have spent buying stock, but it does not feed into Total Expenses or  |
| Net Profit. Buying stock is not itself an expense; see Section 10 for |
| the full explanation of why.                                          |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| **Note**                                                              |
|                                                                       |
| Figures shown are calculated live from your Finance, Sales, and HR    |
| registers --- there is nothing separate to update.                    |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| **Business Unit switcher**                                            |
|                                                                       |
| If your workspace uses more than one business unit, the switcher at   |
| the top of the app controls which business the Dashboard (and most    |
| other screens) is summarizing. Pick a specific business to see that   |
| business's figures only. Choose **All Businesses** to see a combined  |
| view across every business unit. You cannot create or stamp new       |
| records while All Businesses is selected --- switch to a specific     |
| business first. See Section 10.0 for the full explanation.            |
+-----------------------------------------------------------------------+

# **Section 6 --- Finance**

The Finance module is the financial heart of your workspace. All figures
are reconciled monthly and feed directly into your Dashboard and
Reports.

## **6.1 Income Register**

Records all income, whether service-based (e.g. contract billing to a
client) or product sales made through Product Sales or POS. Entries made
through either automatically appear here.

Click the filter icon on the Service Category or Description column
header to search and select one or more values, narrowing the list to
just those entries --- the total shown below the table updates to match
whatever is currently visible.

Entries synced in automatically from a Client Invoice, Platform Billing,
or a system payroll adjustment show an "(auto-posted)" label and cannot
be edited or deleted from this screen --- Edit and Delete are shown
disabled, with a note pointing you to the source (for example, "Void or
delete the Client Invoice instead"). This keeps the register in step
with its source instead of drifting out of sync. Entries you add
yourself here, through Add Entry, keep full Edit and Delete as normal.

## **6.2 Expense Register**

Records all business expenses by category. Use Finance Settings to
manage your list of expense categories. Cost of Goods Sold (COGS) is
posted here automatically whenever you sell stock --- see Section 10 for
how this is calculated.

You can bulk import existing expenses from a spreadsheet using the Bulk
Import button on this page --- see Section 2.4.

Click the filter icon on the Expense Category, Sub-Category, or
Description column header to search and select one or more values ---
combine filters across columns to narrow further. The total shown below
the table always reflects only the rows currently visible.

## **6.3 Accounts Payable**

Tracks amounts your business owes to suppliers or vendors, and their
payment status. Whether a purchase creates an Accounts Payable entry at
all depends on how it was paid --- see Section 10.3 for Cash vs. Credit
purchases.

## **6.4 Fixed Assets**

Maintains your register of fixed assets and their depreciation over
time, using the depreciation methods configured in Finance Settings.
Fixed Assets are equipment, vehicles, and property you keep long-term
--- this is a different concept from Inventory; see Section 10.5 for the
distinction.

You can bulk import your existing asset register from a spreadsheet
using the Bulk Import button on this page --- see Section 2.4.

## **6.5 Manual Financial Entries**

For adjustments and entries that do not belong in the Income or Expense
Registers directly (for example, journal-style corrections).

## **6.5a Budget**

Finance → Budget is where you plan spending by expense category for a
period (for example Monthly Pro-rated), optionally scoped to a project
or contract, and compare that plan to what you have actually spent.

Use it to see budgeted, actual, variance, and status per category ---
the same figures that appear on the Budget vs Actual report. Pick the
month and year you care about; leave project blank for the company-wide
view.

## **6.6 Financial Statements**

Profit & Loss, Cash Flow, and Balance Sheet statements are generated
automatically from your registers and can be viewed by month or exported
from Reports.

Under Finance → Balance Sheet you can also open **Capital
Contributions**, which tracks owner or investor capital injected into
the business (separate from day-to-day income). The Capital Contributions
Summary report rolls the same information up for export.

*Fig. 2 --- Your registers feed all three financial statements
automatically.*

## **6.7 Client Invoices**

Generate professional, contract-based invoices for your own service
clients (for example, monthly cleaning-contract billing) directly from
the ERP, matching your standard invoice format.

-   Each invoice supports site-based or manually entered line items,
    grouped by category, with Service and Material amounts, discounts,
    and line totals.

-   VAT/NHIL/GETFund (20%) is calculated on the Service amount and added
    to the invoice total. Withholding Tax (WHT, 7.5%) is shown for your
    records only and is not subtracted from the amount due.

-   Choose which of your saved Payment Accounts (bank and/or mobile
    money) appear on the invoice.

-   Authorized By --- select who is signing off the invoice from a
    dropdown of your active users, or type a name and title manually.
    The invoice prints a signature line with the name and title beneath
    it.

-   Invoices can be viewed on-screen, printed, or downloaded as a PDF.

-   Status: every new invoice starts as Draft (there is no status field
    to set when creating one). From the Client Invoices list, one-click
    buttons move it forward --- Send, then Mark as Paid --- without
    needing to open Edit; Record Payment (Section 6.11) is still used
    for partial payments. Sent, Partial, and Paid invoices automatically
    appear in your Income Register, with the outstanding balance kept in
    sync as the status changes. An invoice generated automatically from
    a Service Contract (Section 6.12) shows a "From Contract DF-SC-00XX"
    badge linking back to it.

-   Void --- once an invoice has been sent, Delete is replaced with
    Void, so a document your customer has already seen is never silently
    removed. A voided invoice is clearly marked Voided, drops out of
    your outstanding totals, and stays in your records for reference.
    Only Draft invoices can still be deleted outright.

-   Customer Portal --- your customer can view, print, and download any
    invoice you've sent them, at any status (Pending, Overdue, Partial,
    or Paid). Draft invoices, since they haven't been sent yet, are not
    shown to them. Customers use the **Customer Portal** module for this
    --- not Self-Service (which is for your own staff).

Manage your saved payment profiles under Administration → Payment
Accounts (see Section 13.3).

## **6.8 Statutory Ledger**

The Statutory Ledger keeps a running record of everything you owe to, or
are owed by, GRA and SSNIT --- so filing season is never a guessing
game.

-   GRA Tax --- tracks Withholding Tax (WHT) your clients withhold on
    your invoices (an amount owed to you by GRA), and VAT/NHIL/GETFund
    or VFRS you collect and owe to GRA.

-   PAYE and SSNIT --- automatically posted here each time you lock a
    payroll period, split into Employee SSNIT, Employer SSNIT (Tier 1),
    and Tier 2 pension contributions, so each obligation is tracked
    separately.

-   Due-date reminders --- set your filing day for each obligation once
    under Statutory Ledger → Settings. Overdue items are shown clearly
    in red on your dashboard.

-   Mark Period as Remitted --- once you have actually paid GRA or
    SSNIT, mark the period as remitted; the ledger clears that balance
    and automatically rolls the due date forward to the next filing
    period.

## **6.9 VAT/WHT Calculation Basis**

For Client Invoices and Quotations, choose whether VAT and Withholding
Tax are calculated on the service portion only, or on the full line
total.

-   **Service Cost Only (default):** tax is calculated on the
    labour/service cost only, not on materials --- this matches how
    Davors' own invoices have always worked.

-   **Total Cost:** tax is calculated on the full line total (service
    plus materials).

Change this under Administration → Finance Settings → Sales Tax Basis.
Documents already issued keep the basis they were created with; the new
setting applies to new documents, and to any existing one you re-save.

## **6.10 Product Sales Tax Rate**

Choose whether Product Sales and Point of Sale transactions charge VAT
(VFRS) or not.

-   **0% --- No VAT (default):** no VAT is added; the price you set is
    the full price your customer pays.

-   **3% VFRS:** VAT is included in the price you set (tax-inclusive)
    and tracked in your Statutory Ledger like any other VAT, ready to
    remit to GRA.

Change this under Finance → Statutory Ledger → Settings → Product Sales
Tax Rate. The setting applies to sales recorded from that point forward.

*Fig. 6 --- How the Product Sales Tax Rate setting affects what a sale
records.*

## **6.11 Client Receipts & Record Payment**

When a service customer pays a Client Invoice --- in full or in part ---
record the payment and a receipt is issued automatically.

-   **Record Payment:** on any Sent or Partial invoice, log the amount,
    date, and payment method received. The invoice's Amount Received and
    status (Partial/Paid) update automatically from the real total of
    all payments --- you never edit these fields directly once a payment
    exists.

-   **Receipts:** every recorded payment issues its own numbered receipt
    (for example DF-RCPT-0001) under Finance → Client Receipts. A
    partial payment produces its own receipt --- an invoice paid in
    three instalments has three receipts.

-   **Your signature:** upload a signature image once under Workspace
    Settings; it is applied automatically to every receipt and Client
    Invoice from then on.

-   **Customer access:** your customer can view and download their own
    receipts from the Customer Portal, alongside their invoices.

*Fig. 7 --- From Client Invoice to a receipt in the customer's hands.*

## **6.12 Service Contracts**

Set up a recurring billing agreement with a service client so their
invoices are generated for you automatically each period, instead of
being created by hand every time --- for example, Central University's
monthly cleaning-contract billing.

-   **Two ways to start a contract:** create one directly under Finance
    → Service Contracts, or --- the more common path --- open an
    Accepted Client Quotation (Section 7.8) and click Raise Contract.
    This opens a new Draft contract already filled in with that client,
    their line items, and tax settings, so you just confirm the term and
    billing details.

-   **Contract details:** customer, contract number (for example
    DF-SC-0001), start and end date, Auto-Renew, and Billing Frequency,
    which sets how often a new invoice is generated (for example
    monthly).

-   **Line items and rate card:** a contract holds the same category /
    Service & Material / discount line items as a Client Invoice or
    Quotation --- this is the rate card each generated invoice will use.
    Editing a contract's rates later only affects future invoices;
    anything already generated keeps the amounts it was created with.

-   **Automatic invoice generation:** each day, every Active contract
    whose next billing date has arrived gets a new Draft Client Invoice
    created automatically, carrying over the contract's line items, tax
    basis, and a "From Contract DF-SC-00XX" badge so it's easy to trace
    back. The contract's next billing date then advances to the
    following period. You (and your Admins/Directors) get notified when
    a new contract invoice is generated, the same way you're notified
    for other new invoices.

-   **Status:** a contract moves through Draft → Active, then shows
    Renewal Due once it's within 30 days of its end date, and finally
    Expired (if it passes its end date without Auto-Renew) or Terminated
    (if you end it manually). A contract only generates invoices while
    Active.

-   **Generated Invoices:** open any contract to see every Client
    Invoice it has produced, in one place --- useful for checking a
    client's billing history without hunting through the full Client
    Invoices list.

# **Section 7 --- Sales & CRM (including Point of Sale)**

Sales & CRM is where you manage your customers and record every sale ---
whether it is a credit sale to a contract client or a walk-in cash sale
rung up at the till.

## **7.1 Customer List**

Your directory of customers/clients. Each customer can be linked to a
Client-role user account so they can view their own invoices via the
Customer Portal.

You can bulk import your existing customer list from a spreadsheet using
the Bulk Import button on this page --- see Section 2.4.

## **7.1a Services**

Sales & CRM → Services holds your catalogue of service offerings (for
example cleaning packages or facility services) that you sell or quote
to customers --- separate from Finished Products in Inventory.

You can bulk import Services from a spreadsheet using the Bulk Import
button on this page --- see Section 2.4.

## **7.1b Product Catalog (Davors platform)**

On the Davors Facilities platform tenant only, Sales & CRM includes a
**Product Catalog** tab for platform product listings used in billing
and related flows. Other customer workspaces do not see this tab.

## **7.2 Product Sales Register**

A record of every product sale, whether entered directly here or created
through Point of Sale.

Use the filter icon on the Customer, Product, Payment Status, or Status
column header to search and select one or more values; the total shown
below the table reflects only the rows currently visible.

## **7.3 Point of Sale (POS)**

POS provides a cart-based checkout for in-person product sales, and
lives as a tab within Sales & CRM alongside Product Sales.

  **Step**   **What happens**
  ---------- ----------------------------------------------------------------
  1          Add products to the cart from your Finished Products inventory.

  2          Adjust quantities as needed.

  3          Complete the sale --- a single invoice number is generated for
             the whole cart.

  4          A printable receipt is produced automatically.

Each line in the cart is recorded as its own entry in the Income
Register and Product Sales Register. If any line fails (for example,
insufficient stock), the checkout stops and reports the issue before
completing the rest of the sale.

For Mobile Money sales, Complete Sale opens Paystack's secure payment
popup right in the browser --- the customer confirms on their own phone,
and the sale is only recorded once payment is verified; nothing is
deducted from stock until then. If a customer would rather pay from
their own device, Request Payment sends them a secure payment link by
email or SMS instead, with the same protection --- stock and the sale
record are only created once they actually pay. Card payment is not yet
available until in-person card-tap terminal hardware is set up.

## **Product Sales vs. Point of Sale --- which do I use?**

These record the same kind of transaction --- a sale of stock --- but
suit different situations:

               **Product Sales**            **Point of Sale (POS)**
  ------------ ---------------------------- -----------------------------
  Style        Form-based, one product at a Cart-based, several products
               time                         at once

  Payment      Supports credit --- Paid,    Paid immediately --- cash,
               Partial, Pending, Overdue    MoMo, card
               with due dates               

  Best for     Contract or institutional    Walk-in customers buying
               clients who pay later        several things at once

  Receipt      Not always needed on the     Printed immediately at
               spot                         checkout

*Fig. 3 --- Both paths reduce the same stock and calculate your cost of
goods sold automatically.*

+-----------------------------------------------------------------------+
| **Tip**                                                               |
|                                                                       |
| You are not choosing one or the other for your whole business --- use |
| each for what it suits. Log a monthly client invoice through Product  |
| Sales, and ring up a walk-in customer through POS, on the same day.   |
+-----------------------------------------------------------------------+

## **7.4 Sales Log**

A read-only combined view of all sales activity for quick review.

Like Product Sales, use the filter icon on the Customer, Product,
Payment Status, Payment Method, Source, or Status column header to
search and select one or more values; the total below updates to match
what is visible.

## **7.4a Offline Sale Conflicts**

When POS or related sales were recorded while a device was offline,
Sales & CRM → Offline sale conflicts is where you review and resolve
any sync conflicts before they leave your registers inconsistent. Open
each conflict, confirm the correct outcome, and clear it so online and
offline records agree.

## **7.5 Email & Promotions**

Email & Promotions lets you communicate with your own customers directly
from the platform, in two distinct ways: marketing campaigns you send
yourself, and transactional notifications the platform sends
automatically when something happens (a sale, a payment, an invoice).

**Templates.** Every message starts from a template --- Marketing or
Transactional, Email or SMS or both. Templates support placeholders like
{{customer_name}} that are filled in automatically for each recipient.

**Marketing Campaigns.** Create a draft campaign, pick a template,
choose an audience (all customers, or customers of a specific type), and
send. Before sending, you are always shown exactly how many customers
are in the audience and how many are eligible to receive it. Every
marketing email includes an unsubscribe link --- customers who
unsubscribe are never contacted for marketing again, though they still
receive transactional notifications below.

**Transactional Notifications.** Configure once, under the Notification
Rules tab, and the platform sends automatically:

  **Event**           **Sent when**
  ------------------- ---------------------------------------------------
  Sale Completed      A product sale or POS sale finishes successfully.

  Payment Received    A Mobile Money or card payment is confirmed for a
                      sale.

  Invoice Created     A new client invoice is generated.

Transactional notifications are service messages, not marketing --- they
are sent even to customers who have unsubscribed from campaigns, the
same way a receipt or a bank alert is not something you can opt out of
while still using the service.

+-----------------------------------------------------------------------+
| **Worked Example --- A Real Campaign, Confirmed Live**                |
|                                                                       |
| Template: Marketing / Email --- Subject "Test Campaign", Body "Hi     |
| {{customer_name}}, this is a test."                                   |
|                                                                       |
| Campaign: "Test Campaign 1", Audience: All Customers, reference code  |
| CAN-CAMP-0006.                                                        |
|                                                                       |
| What the customer received (this exact email was sent and confirmed   |
| delivered):                                                           |
|                                                                       |
| *Subject: Test Campaign*                                              |
|                                                                       |
| *"Hi Central University, this is a test."*                            |
|                                                                       |
| *Unsubscribe:                                                         |
| https://portal.davorsfacilities.com/unsubscribe/\[your-link\]*        |
+-----------------------------------------------------------------------+

## **Choosing the Right Audience**

The "By Customer Type" audience option filters to one specific customer
classification, not a broad category:

  **Audience option**      **Who it reaches**
  ------------------------ ----------------------------------------------
  All Customers            Every active customer, regardless of type. Use
                           this for a general announcement.

  By Customer Type:        Only customers tagged specifically as a
  Service Customer         Service Customer.

  By Customer Type:        Only customers tagged specifically as a
  Digital Subscriber       Digital Subscriber.

  By Customer Type: Both   Only customers tagged as BOTH a Service
                           Customer and a Digital Subscriber at once ---
                           a narrow group, not "both of the above
                           combined."

+-----------------------------------------------------------------------+
| **Tip**                                                               |
|                                                                       |
| If a campaign shows an unexpectedly small or zero audience, check the |
| audience selection first --- "By Customer Type: Both" is the most     |
| common cause, not a system fault.                                     |
+-----------------------------------------------------------------------+

## **Transactional Notification Placeholders**

Each Notification Rule is tied to one event --- Sale Completed, Payment
Received, or Invoice Created --- and the placeholders available depend
on which event a template is used for. The same placeholder name is
sometimes reused with a different meaning on a different event, so a
template built for one event should not be reused on another without
checking this list first. {{customer_name}} is the one placeholder safe
to use everywhere --- on all three transactional events and on Marketing
Campaign templates.

  **Event**       **Available             **What they mean**
                  placeholders**          
  --------------- ----------------------- --------------------------------
  Sale Completed  {{invoice_no}}          Sale invoice number • Sale total
                  {{amount}}              • List of products sold
                  {{product_summary}}     

  Payment         {{amount}}              Amount paid • Payment reference
  Received        {{payment_reference}}   • Related sale invoice number
                  {{invoice_no}}          

  Invoice Created {{invoice_number}}      Client invoice number (note: a
                  {{amount}} {{due_date}} different placeholder name from
                                          {{invoice_no}} above) • Total
                                          amount due • Due date

+-----------------------------------------------------------------------+
| **Tip**                                                               |
|                                                                       |
| A placeholder that isn't valid for the event it's attached to is not  |
| blocked or blanked out --- it is sent to the customer exactly as      |
| typed, e.g. literally "{{due_date}}". Always check this list before   |
| saving a new transactional template.                                  |
+-----------------------------------------------------------------------+

**Status.** Email & Promotions is fully live --- marketing campaigns and
all three transactional notification types have been confirmed working
end-to-end, including real email delivery.

-   SMS sending is built throughout the platform but not yet turned on
    for your workspace --- email is fully live.

-   There is no audience targeting beyond "All Customers" and "By
    Customer Type" yet.

-   Large audiences send in batches and may need you to click "Continue
    Sending" more than once.

-   Unsubscribing opts a customer out of all marketing channels at once;
    there is no separate email/SMS preference yet.

## **7.6 Sales Pipeline**

Track a potential deal from first contact through to won or lost, so
nothing falls through the cracks before it becomes a sale.

-   **Stages:** New, Contacted, Qualified, Proposal Sent, Negotiation,
    Won, or Lost. Move a deal forward using the dropdown on its card;
    marking one Lost asks for a short reason.

-   **Follow-ups:** each opportunity can have its own list of calls,
    tasks, or notes with due dates, so you always know who to contact
    next.

-   **New leads:** add an opportunity for an existing customer, or
    create a brand-new lead customer inline without leaving the form.

-   **Editing & deleting:** click an opportunity's title or the pencil
    icon to edit its details; the trash icon deletes it after a
    confirmation, but only if it has no linked quotes or quotations ---
    convert or remove those first.

+-----------------------------------------------------------------------+
| **Tip**                                                               |
|                                                                       |
| Marking an opportunity Won automatically switches that customer's    |
| status from Lead to Active --- you do not need to update it yourself. |
+-----------------------------------------------------------------------+

## **7.7 Product Quotes**

Before a sale is finalised, send a customer a quick product estimate
they can review and accept --- line items are drawn from your Finished
Products, with quantity and unit price, just like Point of Sale.

-   **Status:** a quote moves through Draft, Sent, and then Accepted,
    Rejected, or Expired.

Once a quote is Accepted, a Convert button appears:

-   Convert to Sale opens Point of Sale with the cart already filled in
    --- you still complete checkout and take payment as normal.

+-----------------------------------------------------------------------+
| **Tip**                                                               |
|                                                                       |
| Converting a quote never skips your normal checks --- stock           |
| availability is still validated and tax is still calculated exactly   |
| the way it always is.                                                 |
+-----------------------------------------------------------------------+

## **7.8 Client Quotations & Pro-forma Invoices**

Send a customer a formal, branded quotation or pro-forma invoice, with
your company logo, address, and payment details already on the document.

-   **Document Type:** choose Quotation or Pro-forma Invoice --- this
    only changes the title printed at the top of the document,
    everything else works the same.

-   **Line items:** site-based or manually entered, grouped by category,
    with Service and Material amounts, discounts, and line totals ---
    the same structure as a Client Invoice.

-   **Tax:** VAT/NHIL/GETFund (20%) and Withholding Tax (WHT, 7.5%) are
    calculated the same way as on Client Invoices.

-   **Valid Until:** defaults to 30 days from the issue date, and can be
    changed.

-   **Payment Accounts:** choose which of your saved bank or mobile
    money accounts appear on the document.

-   **Authorized By:** required on every quotation --- select who is
    signing off from a dropdown of your active users, or type a name and
    title manually. If your workspace has a stored signature image set
    up (Workspace Settings), it prints automatically alongside the name
    and title; otherwise a blank signature line is shown.

-   **Status:** every new quotation starts as Draft (there is no status
    field to set when creating one). From the Quotations list, one-click
    buttons move it forward --- Send, then Accept or Decline --- without
    needing to open Edit.

Once a quotation is Accepted, two buttons become available on the list:
Convert to Invoice creates a real Client Invoice with the next invoice
number, carrying over the client, line items, and payment accounts ---
you still review and save it yourself; and Raise Contract opens a new
Draft Service Contract (Section 6.12) pre-filled from the quotation, for
clients you bill on a recurring basis rather than a one-off invoice.
Once a contract is raised, the quotation shows a "Contract Raised →
DF-SC-00XX" badge linking back to it.

Quotations can be viewed on-screen, printed, or downloaded as a PDF.

+-----------------------------------------------------------------------+
| **Tip**                                                               |
|                                                                       |
| Product Quotes (Section 7.7) is for a quick product estimate that     |
| converts straight into a Point of Sale sale. Client Quotations is for |
| the formal, branded document you send a client for contract or        |
| service work, complete with tax and payment details.                  |
+-----------------------------------------------------------------------+

## **7.9 Customer 360**

Click any customer's name in the Customer List to open their full
profile in one place.

-   **Summary numbers:** Total Product Sales, Total Invoiced, Total
    Received, and Days Since Last Activity.

-   **Tabs:** Opportunities, Quotes, Invoices, Product Sales, and
    Activities --- everything about that one customer, without running
    separate reports.

## **7.10 Returns, Credit Notes & Refunds**

Handle a customer return or an adjustment to an invoice without
rewriting the original sale record.

-   **Product returns:** from the Sales Log, use Return on a completed
    sale. Choose the quantity being returned and, for each item, whether
    it is going back on the shelf or being written off.

  **Disposition**     **What happens to stock**   **What happens to
                                                  cost**
  ------------------- --------------------------- -----------------------
  Restock             Added back to sellable      The original cost of
                      stock immediately.          those units is reversed
                                                  --- no net cost, since
                                                  the goods are sellable
                                                  again.

  Damaged / Write-Off Not added back --- stays    The original cost stays
                      out of sellable stock.      as-is, since the goods
                                                  are gone for good.

-   **Invoice credit notes:** from a Client Invoice, use Issue Credit
    Note to offset what is owed, without changing the original invoice.

-   **Refunds:** every credit note is listed under Finance → Credit
    Notes with its own number. Use Record Refund only when cash actually
    goes back to the customer.

+-----------------------------------------------------------------------+
| **Tip**                                                               |
|                                                                       |
| A credit note by itself does not mean cash left the till. Recording   |
| the refund as a separate step keeps your cash position accurate.      |
+-----------------------------------------------------------------------+

## **7.11 Discounts & Loyalty Points**

Run promotions and reward repeat customers, on Point of Sale, Quotes,
and Client Invoices alike.

-   **Discount codes:** create a code under Discounts --- percentage or
    fixed amount off, optionally limited by minimum order, a date range,
    a total usage cap, or uses per customer. Apply a code from the Promo
    Code box at checkout, on a Quote, or on a Client Invoice.

-   **Loyalty points:** customers earn points automatically as they
    spend, and can redeem them for a discount on a future purchase using
    Redeem Points at checkout.

-   **Your rates, your control:** how many points are earned per amount
    spent, and what each point is worth when redeemed, are both set
    under Loyalty Settings --- you can change either rate at any time.

A customer's points balance and full history are always visible on
their Customer 360 profile, under the Loyalty tab.

## **7.12 Sales Targets, Commissions & Forecasting**

Every sale can be credited to a Sales Rep, which is what targets,
commissions, and forecasting are built on.

-   **Sales Rep:** shown at checkout on Point of Sale and on Client
    Invoices, defaulting to whoever is logged in, but changeable to any
    employee.

-   **Sales Targets:** set a revenue target, a unit or deal-count
    target, or both, for an employee over a monthly, quarterly, or
    yearly period.

-   **Commission Rules:** set a commission rate for a specific employee,
    or for a whole position as a fallback when no employee-specific rate
    is set. A rule can be deleted once no longer needed (existing
    calculated commissions are unaffected); to keep the history but stop
    it applying, edit the rule and uncheck Active instead.

-   **Commissions:** pick an employee and a period and calculate their
    commission with one click --- it totals their attributed sales for
    that period and applies the right rate. Approve and Mark Paid track
    the payout from there; a Pending calculation can also be Cancelled
    if it was raised in error, removing it from the approval queue.

-   **Sales Forecast:** see a pipeline-weighted forecast (each open
    opportunity's value multiplied by its likelihood of closing) side
    by side with actual revenue and your targets, month by month.

# **Section 8 --- HR Management**

HR Management is organised into groups: Employees, Payroll, HR
Operations, Leave Approvals (when you are an assigned approver), and
Employee Announcements.

## **8.1 Employees**

Maintains employee records, employment history, and staff ID cards.

Every employee has an Employment Type --- Casual, Part-Time, Full-Time,
or Contract. Contract employees are treated the same as
Full-Time/Part-Time staff for tax purposes: standard PAYE and SSNIT both
apply. Casual staff use a separate flat-rate tax calculation with no
SSNIT --- see Section 8.2 for how this affects payroll.

You can bulk import your existing staff list from a spreadsheet using
the Bulk Import button on the Employee Directory --- see Section 2.4.

## **8.2 Payroll**

-   Payroll Processing --- runs monthly payroll based on your salary
    rate structures and statutory settings

-   Payroll History --- past periods and what was processed

-   Payslips --- generated per employee per pay period

-   PAYE, SSNIT, and Casual Tax configuration --- set under HR Settings,
    applied automatically during processing

-   Salary Settings --- set default Basic Salary and allowances
    (Housing, Transport, Night Differential, and any others you add)
    once per Position and Employment Type. Every employee's pay is then
    read automatically from these settings --- no need to re-enter
    figures per person, and no risk of two staff in the same role ending
    up with different, inconsistent pay.

## **8.3 HR Operations**

-   Attendance --- record and review attendance

-   Leave --- requests and day-to-day leave handling. Default
    entitlement days for Annual, Sick, and Unpaid Leave can be set once
    per Position and Employment Type under Leave Settings → Leave
    Entitlements, so new hires get the correct balance automatically;
    individual staff can still be adjusted separately if needed.

-   Leave Balances --- see and adjust remaining leave days per employee

-   Overtime --- record and review overtime

-   Loans --- staff loan register

-   Disciplinary --- disciplinary records

-   Exit Management --- resignations, terminations, and exit processing

-   Equipment Register --- equipment issued to or held by staff

-   Staff Kit Register --- kits and related assets issued to staff

-   Staff ID Cards --- generate and manage staff ID cards

## **8.3a Leave Approvals**

If you are set up as a leave approver, HR Management → Leave Approvals
is your inbox for leave requests waiting on you. Approve or reject from
there --- this is separate from Self-Service, which only shows your own
leave as an employee.

## **8.4 Employee Announcements**

Employee Announcements lets you message your own staff directly from the
platform --- by email, SMS, or an in-app notification --- separate from
Email & Promotions in Section 7.5, which is for your customers.

The module has two tabs:

-   **Templates** --- reusable message templates (or write a one-off
    notice). Templates support placeholders such as {{employee_name}},
    {{staff_id}}, and {{position}} that are filled in automatically for
    each recipient.

-   **Campaigns** --- the actual sends. Create a draft, choose a
    template (or write a one-off message), pick your audience, and send.

**Sending an Announcement.** Delivery happens per employee, on whichever
channels they can actually be reached on: email if one is on file, SMS
if they have a phone number, and an in-app notification if they have a
login. An employee who qualifies for more than one channel receives all
of them, not just one.

**Choosing an Audience.** A single announcement can combine several ways
of reaching people at once:

-   All Employees

-   One or more Positions

-   One or more Shifts

-   One or more Employment Types

-   Specific named employees, picked individually

These combine into one list --- anyone matching at least one of your
choices receives the announcement once, even if they match more than one
way.

**Viewing a Sent Announcement.** Open any announcement from the list to
see exactly who received it --- name, channel, and delivery status ---
along with the exact message they were sent, placeholders already filled
in.

**The Notification Bell.** Every logged-in user has a bell icon showing
unread announcements. Clicking one marks it read; "Mark All As Read"
clears everything at once. Each person only ever sees their own
notifications, never anyone else's.

+-----------------------------------------------------------------------+
| **Worked Example --- Reaching a Mixed Group in One Send**             |
|                                                                       |
| Template: Payroll Notice (SMS) --- "Hi {{employee_name}}, your        |
| payslip for the period is ready to view."                             |
|                                                                       |
| Audience: Position "Chief Executive Officer" plus two named           |
| individuals added directly --- the announcement reaches everyone      |
| matched by the position AND the two named staff, once each, with no   |
| duplicates.                                                           |
+-----------------------------------------------------------------------+

**Status.** Templates, Campaigns, sending across all three channels, the
recipient/message view, mixed-audience targeting, and the notification
bell are all live.

+-----------------------------------------------------------------------+
| **Note**                                                              |
|                                                                       |
| Payroll periods can be locked, released, reopened, or repaired by an  |
| Admin --- talk to your administrator if a payroll period needs        |
| correction after processing.                                          |
+-----------------------------------------------------------------------+

# **Section 9 --- Operations**

Operations is where you run sites day to day --- rostering, work,
inspections, and issues. Tabs include:

-   Duty Roster --- assigns staff to sites and shifts (see Section 9.1)

-   Roster History --- review past roster rotations without opening the
    live Duty Roster editor

-   Sites --- your register of managed locations

-   Consumables --- site consumables tracking

-   Work Orders --- track maintenance and service jobs

-   Inspection Summary --- overview of inspection results by site

-   Failed Inspections --- inspections that failed and need follow-up

-   Corrective Actions --- actions raised to fix failed inspections or
    related findings

-   Complaint Register --- customer or site complaints

-   Incident Register --- operational incidents

Supervisors who only have Customer List access also see Customer List as
a tab here; full Sales & CRM remains separate for roles that have it.

## **9.1 Duty Roster --- Reviewing Past Rotations & Approvals**

Beyond assigning staff to sites and shifts, Duty Roster lets you review
history and formally approve a rotation.

-   **Rotation selector:** switch between the current rotation and any
    past one for the selected customer using the dropdown at the top of
    the page. A past rotation opens read-only, showing the full
    facility, shift, and staffing detail exactly as it was --- not just
    a flat change log.

-   **Staffing-gap indicator:** any facility where Actual staff falls
    short of Required staff is highlighted amber with a "Short staffed"
    badge, and the totals row is flagged too if the shortfall is overall
    --- so a gap is never buried in the numbers.

-   **Approval:** once a rotation is reviewed, Approve records who
    approved it and when; an approved rotation locks (read-only) and
    shows your saved signature on its printout, the same signature used
    on receipts and invoices.

-   **Download PDF:** saves a real PDF file of the roster, separate from
    Print, which opens your browser's print dialog.

*Fig. 8 --- Duty Roster: rotation review and approval.*

# **Section 10 --- Inventory (Production & Purchasing)**

Every item you sell lives in one place: Finished Products. It does not
matter whether you made it yourself or bought it from a supplier ---
once it is stock, it is stock. What differs is only how it got there,
and that is reflected in how the Inventory sidebar is organised:
Finished Products sits on its own, with two groups underneath it ---
Production and Purchasing.

*Fig. 4 --- Two roads in, one shared stock list.*

## **10.0 Business Units (multiple businesses under one workspace)**

Some workspaces run more than one business under the same company login
--- for example Davors Facilities, Davors Logistics, and Davors
Enterprise. Each of those is a **Business Unit**.

-   Admins create and name business units under Administration →
    Workspace Settings → Business Units (Section 13).

-   Use the **Business Unit switcher** at the top of the app to choose
    which business you are working in.

-   **A specific business** --- lists, stock quantities, costs, and most
    new records are scoped to that business only. Inventory stock and
    weighted average cost are kept **per business unit**, so Logistics
    stock does not appear as Facilities stock.

-   **All Businesses** --- a combined read-only style view across every
    business unit. You can review totals, but you **cannot create or
    stamp** new purchases, production, stock adjustments, or similar
    records while All Businesses is selected. Switch to a specific
    business first; the system will refuse All Businesses create
    attempts with a clear message.

-   The workspace **default** business (often shown without a named
    unit, or as your primary facilities business) uses the same rules:
    pick it explicitly when you need to post stock there.

Suppliers are shared directory data for the whole workspace (every
business unit can use the same supplier list). Purchases, purchase
orders, production, balances, and stock adjustments are scoped to the
business unit they were recorded under.

## **10.1 Finished Products**

Your master list of sellable items. Each product is tagged with a
Sourcing type:

Each product can also have a photo, shown as a thumbnail here and
wherever staff select the product at Point of Sale or Product Sales ---
useful when a name alone is not enough to recognize what is being sold.

-   Manufactured --- produced in-house through a Production Batch

-   Purchased --- bought from a supplier for resale

+-----------------------------------------------------------------------+
| **Tip --- cost on Finished Products**                                 |
|                                                                       |
| On the product master itself you do not type a standing unit cost.    |
| Day-to-day cost per unit is calculated as a weighted average for the  |
| **active business unit**, from production batches, product purchases, |
| less sale COGS and internal consumption, plus manual stock            |
| adjustments (Section 10.6). When you use **Record Stock Adjustment**  |
| with Opening Balance or Found Stock, you **do** enter Cost per Unit   |
| for that adjustment --- that is how opening or found stock joins the  |
| average-cost calculation.                                             |
+-----------------------------------------------------------------------+

You can bulk import your existing product list from a spreadsheet using
the Bulk Import button on this page --- see Section 2.4. The product
list for pickers (for example Record Stock Adjustment) shows the full
catalogue so a business unit can select a product even before it has
stock there; the on-hand list for a named business only shows products
that already have a stock balance in that business.

## **10.2 Production**

Covers Raw Materials, Production Batches, and Internal Consumption ---
everything involved in making your own stock.

-   Raw Materials --- materials bought to be used in production; stock
    and weighted average cost update automatically as you record
    purchases (and stock adjustments), **per business unit**

-   Production Batches --- record what you produced, from which raw
    materials, and the batch cost feeds into the finished product's
    average cost for that business

-   Internal Consumption --- stock used up internally (e.g. cleaning
    supplies) rather than sold; posted as an expense immediately since
    it is not becoming resale inventory, and it reduces the weighted
    average cost pool for that product/business

## **10.3 Purchasing**

Covers Suppliers, Purchase Orders, and Purchases --- everything involved
in buying stock from outside your business.

-   Suppliers --- your directory of who you buy from (shared across
    business units)

-   Purchase Orders --- an optional planning step; a Purchase Order
    records what you intend to buy and from whom, before anything has
    arrived, stamped to the active business unit

-   Purchases --- the actual event; recording a Purchase increases stock
    for that business unit and, if bought on credit, creates an Accounts
    Payable entry

## **Purchase Order vs. Purchase --- what's the difference?**

  **Purchase Order (PO)**             **Purchase**
  ----------------------------------- -----------------------------------
  A plan / promise: \"I intend to buy The actual event: goods arrived,
  X units from Supplier Y at price    money is now owed.
  Z.\"                                

  Nothing has happened yet --- no     This is what actually moves stock
  money owed, no stock received       and creates the payable

A Purchase Order is entirely optional. Skip it and record a Purchase
directly for the simple, everyday flow. Use a Purchase Order when you
want to formally commit to an order before goods arrive, or check a
delivery against what was expected --- when you record the Purchase
against that PO, its \"received\" quantity and status update
automatically.

## **The Price Variance Warning**

When recording a Purchase against a Purchase Order line, if the actual
cost per unit differs from the agreed price, you will see a warning such
as:

+-----------------------------------------------------------------------+
| **Example**                                                           |
|                                                                       |
| \"This is 150% higher than the PO price of GHS 20.00.\"               |
+-----------------------------------------------------------------------+

This never blocks the purchase from being recorded --- the real invoice
price is always what is used for your stock cost and payables. The
warning simply makes sure a supplier's price change does not go
unnoticed.

## **Cash vs. Credit Purchases**

Whether a Purchase creates an Accounts Payable entry depends on the
payment method you select:

+-----------------------------------------------------------------------+
| **How it works**                                                      |
|                                                                       |
| Any payment method whose name contains \"credit\", \"on account\",    |
| \"accounts payable\", or \"supplier credit\" is treated as Credit --- |
| it creates a payable, marked Outstanding. Everything else --- Cash,   |
| POS, MoMo, Bank Transfer --- is treated as immediate: no payable is   |
| created, since nothing is owed.                                       |
+-----------------------------------------------------------------------+

## **10.4 Correcting a Mistake**

Purchases and Purchase Orders are not directly editable once recorded,
to protect your financial records from accidental drift. Instead:

-   Delete a Purchase to reverse its stock increase and remove its
    linked payable --- only allowed if none of that stock has already
    been sold or the payable already paid

-   Delete a Purchase Order --- only allowed if nothing has been
    received against it yet; otherwise, use it as a historical record

For quantity or cost mistakes that are not a simple delete --- missing
opening stock, found stock, write-offs, or quantity corrections --- use
**Record Stock Adjustment** on Raw Materials or Finished Products
(Section 10.6) under the correct business unit. Do not invent a fake
purchase or production batch just to move the number.

## **10.5 Fixed Assets vs. Inventory**

Two completely separate concepts, tracked in separate modules --- it is
easy to mix these up, so here is the distinction in one place.

  **Inventory**                       **Fixed Assets**
  ----------------------------------- -----------------------------------
  Raw Materials, Finished Products    Equipment, vehicles, furniture,
  --- bought to be used up or resold  buildings --- bought to be kept and
                                      used long-term

  Turns into revenue (sold) or gets   Not sold; slowly loses value over
  consumed                            time (depreciation)

  Never depreciated                   Tracked on the Fixed Asset &
                                      Depreciation Schedule report
                                      (Section 6.4)

+-----------------------------------------------------------------------+
| **Note**                                                              |
|                                                                       |
| A raw material or product purchase correctly never appears on the     |
| Fixed Asset report --- that is expected, not a fault. Only real       |
| long-term equipment or property purchases belong there.               |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| **Note --- who can edit Inventory**                                   |
|                                                                       |
| Viewing inventory is available to Admin, Operations Manager, Director,|
| Finance, and Sales Rep roles (subject to your plan). **Editing** ---  |
| adding products, recording purchases, production, and stock           |
| adjustments --- is restricted to Admin, Operations Manager, and       |
| Director. Finance can view stock but does not edit inventory records. |
+-----------------------------------------------------------------------+

## **10.6 Record Stock Adjustment (Raw Materials and Finished Products)**

Both **Raw Materials** and **Finished Products** include a **Record
Stock Adjustment** section. Use it when stock must move without a normal
purchase, production batch, sale, or internal consumption --- for
example opening balances when you go live, stock found in the store, a
quantity correction, or a write-off.

You must be on a **specific business unit** (not All Businesses). The
adjustment is stamped to that business, and the Stock Adjustments
history table below the form shows only adjustments for the business you
are viewing.

**Adjustment types**

  **Type**           **Quantity**                 **Cost per Unit**
  ------------------ ---------------------------- ---------------------------
  Opening Balance    Quantity to add (positive)   Required --- you enter it
  Found Stock        Quantity to add (positive)   Required --- you enter it
  Write-off          Quantity to remove (entered  Not entered --- the system
                     as a positive amount to      captures the current
                     remove; saved as negative)   business-unit average cost
  Correction         Direction Increase or        Not entered --- the system
                     Decrease, then a positive    captures the current
                     quantity                     business-unit average cost

-   Opening Balance and Found Stock update quantity **and** join the
    weighted average cost calculation using the cost you enter.

-   Correction and Write-off change quantity only for costing purposes
    in the sense that they reuse the current average cost automatically
    --- the system will reject a manually typed cost for those two
    types.

-   Reason is always required; Notes are optional.

**Weighted average cost (per business unit).** For finished products,
average cost for a business unit is built from production batch costs +
product purchases − sale COGS − internal consumption value + manual
stock adjustments (quantity × cost on each adjustment row), divided by
current stock for that business. Raw materials follow the same idea
through their purchase and adjustment helpers. Always switch to the
business unit whose stock you mean before adjusting.

# **Section 10A --- Real Estate (Davors platform only)**

Real Estate appears in the sidebar only for Davors Facilities platform
staff with Admin or Director access on the Davors tenant. Ordinary
customer workspaces do not see this module.

Use it to run the managed property portfolio:

-   Landlords --- landlord directory

-   Properties --- buildings and sites under management

-   Applications --- tenancy applications

-   Tenants --- lessees / tenants

-   Leases --- active and historical leases

-   Rent Ledger --- rent charges and balances

-   Payouts --- landlord payouts

-   Maintenance --- maintenance jobs

-   Complaints --- property complaints

-   Inspections --- property inspections

-   Expenses --- property-related expenses

-   Announcements --- Templates and Campaigns for landlord/tenant
    messaging (separate from Sales Email & Promotions and HR Employee
    Announcements)

Related Real Estate reports (Vacancy Rate, Occupancy, Arrears Aging,
Income by Property) appear under Reports when you have this access.

# **Section 11 --- Self-Service**

Self-Service is for **your own staff** --- every staff role can open it.
It is **not** where customers log in; customers use the **Customer
Portal**.

The four tabs are:

-   My Payslip --- your payslips

-   My Attendance --- your attendance

-   My Leave --- your leave requests and balances

-   My Roster --- your duty roster assignments

Leave requests that need **your approval as a manager** appear under HR
Management → Leave Approvals (Section 8.3a), not under Self-Service.

# **Section 12 --- Reports**

Reports are organized into up to **eight** categories, depending on your
role and whether Real Estate is available:

1.  Finance --- Monthly P&L Statement; Cash Flow Statement; Monthly
    Balance Sheet; Accounts Receivable Aging; Expense Report; Budget vs
    Actual; Fixed Asset & Depreciation Schedule; Statutory Liabilities
    Report; Capital Contributions Summary

2.  HR & Payroll --- Monthly Payroll Summary; Attendance Summary; Leave
    Balance; Loan Register Summary; Overtime Summary; Headcount &
    Contract Expiry

3.  Operations --- Quality KPI Summary; Site Performance Report;
    Corrective Action Status

4.  Inventory --- Stock on Hand; Production History; Internal
    Consumption

5.  Sales --- Product Catalog; Product Sales

6.  Customer-Facing --- Monthly Customer Service Report

7.  Incidents --- Individual Incident Report; Monthly Incident Summary;
    Escalated Incidents Report; Recurring Issue / Trend Report

8.  Real Estate (Davors platform staff only) --- Vacancy Rate;
    Occupancy; Arrears Aging; Income by Property

Every report can be exported to CSV or sent to print directly from the
browser.

-   Stock On Hand --- values every item using the same combined
    production-and-purchase (and adjustment) cost basis as the Balance
    Sheet for the business unit you are viewing, so the two stay aligned

+-----------------------------------------------------------------------+
| **Note**                                                              |
|                                                                       |
| PDF export is not currently available --- use your browser's \"Save  |
| as PDF\" option from the print dialog if you need a PDF copy.         |
+-----------------------------------------------------------------------+

# **Section 13 --- Administration**

Administration is where Admin-role users configure the workspace. It is
organized into the following groups:

  **Group**          **What it controls**
  ------------------ ----------------------------------------------------
  Finance Settings   Expense Categories; Expense Sub-Categories; Payment
                     Methods; Payment Accounts; VAT/WHT Calculation Basis
                     (Sales Tax Basis --- see also Section 6.9); Asset
                     Categories; Depreciation Methods; Inventory Go-Live;
                     Approvers

  HR Settings        PAYE/SSNIT/casual tax configuration, Salary Settings
                     (default pay and allowances by Position/Employment
                     Type), Leave Settings (approver and default leave
                     entitlements), Manage Positions, roster
                     configuration

  Operations         Service Categories, Contract/Project Assignments,
  Settings           Roster Settings

  User Accounts      Create, edit, deactivate, reset passwords for, or
                     delete users in your workspace

  Workspace Settings Business Units; Workspace Settings (name, logo,
                     address, signature); Billing Settings; Report a
                     Problem

  Platform Settings  Tenant Management; Tier Pricing; Platform Unit
  (Davors platform   Pricing --- Davors platform super Admin only
  only)              

  Monitoring &       System Event Log; User Activity Log; Support
  Support (Davors    Tickets; Platform SMS Usage --- Davors platform
  platform only)     super Admin only

## **13.1 Managing User Accounts**

From Administration → User Accounts, an Admin can:

-   Create a new user and assign their role

-   Edit an existing user's role, linked employee/client, or supervised
    sites

-   Reset a user's password

-   Deactivate a user (they can no longer log in, but their historical
    records are preserved)

-   Delete a user entirely (only possible once their leave-approver and
    other dependencies are cleared)

+-----------------------------------------------------------------------+
| **Note**                                                              |
|                                                                       |
| You will only ever see and manage users within your own workspace --- |
| this list never includes staff from any other company on the          |
| platform.                                                             |
+-----------------------------------------------------------------------+

## **13.2 Workspace Settings and Business Units**

**Workspace Settings** --- set your workspace name, business address,
phone, and email, and upload your own logo and signature. These appear
in your sidebar and on printed documents such as payslips, reports, and
client invoices. Your login and signup pages remain generically branded
as Davors Facilities.

**Business Units** --- create and manage the named businesses under your
workspace (Section 10.0). Each unit can be selected from the Business
Unit switcher. Removing or renaming a unit does not delete historical
stock or finance rows already stamped to it.

**Billing Settings** --- also listed under Workspace Settings in the
sidebar; see Section 14.1 for what you can change there.

**Report a Problem** --- send a support issue to Davors from inside the
app when something is wrong.

## **13.3 Payment Accounts**

Save one or more payment profiles --- bank account and/or mobile money
details --- so they can be selected when generating a Client Invoice.
Add, edit, or deactivate payment accounts from Administration → Finance
Settings → Payment Accounts.

**Payment Settlement.** When a customer pays by Mobile Money or card
through POS, the payment settles directly to your own linked bank or
mobile money account, not to Davors. Keep those profiles up to date
under Payment Accounts / Billing Settings as applicable.

## **13.4 Inventory Go-Live**

Set the date your Inventory tracking goes live, and your opening
inventory value, from Administration → Finance Settings → Inventory
Go-Live. Purchases and stock movements from before this date are not
posted to your financial statements --- this lets you start using
Inventory mid-year without distorting your historical books. For
quantity opening balances **per business unit** after go-live, use
Record Stock Adjustment → Opening Balance (Section 10.6).

## **13.5 Platform Settings and Monitoring (Davors only)**

These groups appear only for Davors Facilities platform super Admins:

-   Tenant Management --- customer workspaces on the platform

-   Tier Pricing --- ERP Suite plan prices and Paystack plan linkage

-   Platform Unit Pricing --- unit-based platform billing configuration

-   System Event Log --- platform system events

-   User Activity Log --- high-level activity monitoring

-   Support Tickets --- inbound support

-   Platform SMS Usage --- SMS credit usage across the platform

# **Section 14 --- Your Subscription**

New workspaces receive 90 days of full free access (trial = every
feature unlocked). After trial, four subscription tiers --- Starter,
Professional, Business, and Enterprise --- gate modules as below.
Billing is per company account, not per user seat.

Verified against the live tier entitlement map (`tier_features`):

  **Tier**         **Includes**
  ---------------- ------------------------------------------------------
  Starter\         Always included (not feature-gated): Finance (Income
  (base)\          Register, Expense Register, Accounts Payable, Fixed
                   Assets, Manual Financial Entries, Budget, Profit &
                   Loss, Cash Flow, Balance Sheet, invoices, receipts,
                   statutory ledger, and related Finance reports); HR &
                   Payroll (Employees, Payroll Processing & History,
                   Attendance, Leave, Loans, Overtime, Disciplinary,
                   Exit, Equipment, Staff Kit, ID Cards, announcements);
                   Self-Service; Administration for your workspace.

  Professional\    Everything in Starter, plus:\
                   Operations (Duty Roster, Roster History, Sites,
                   Consumables, Work Orders, inspections, Corrective
                   Actions, Complaint & Incident registers, Operations
                   and Incidents and Customer-Facing reports);\
                   Sales & CRM core (Customer List, Services, Product
                   Sales, Sales Log, pipeline/quotes/targets as
                   available, Sales reports).

  Business\        Everything in Professional, plus:\
                   POS;\
                   Inventory (Finished Products, Raw Materials,
                   Production, Internal Consumption, Purchasing / POs /
                   Suppliers, stock adjustments, Inventory reports).

  Enterprise\      Everything in Business, plus:\
                   Email & Promotions (Templates, Campaigns,
                   Notification Rules).\
                   Multi-business **Business Units** under one workspace
                   are available as a workspace capability (Section
                   10.0), not a separate paid add-on. External API
                   access for third-party integrations remains planned,
                   not yet generally available.

Your subscription tier is currently set up on your behalf by the Davors
Facilities team --- contact support if you would like to select or
change your tier ahead of your trial ending. Current GHS list prices for
ERP Suite plans are maintained under Administration → Platform Settings
→ Tier Pricing (Davors platform Admins); customer Billing Settings shows
the plan on your own account.

## **14.1 Billing Settings**

View and manage your subscription from Administration → Billing
Settings:

-   Subscription Plan --- see your current tier and request a plan
    change; your Davors Facilities contact confirms and applies it.

-   Email Recipient --- set which email address receives billing-related
    notices.

-   Billing Address & Tax ID --- save your registered business address
    and tax identification number for use on billing documents.

-   Past Invoices, Payment Methods, and Credit Balance show your real
    billing history and payment activity, synced automatically from your
    online payments.

## **14.2 Cancelling Your Subscription**

If you need to cancel, scroll to the bottom of Billing Settings, where a
clearly marked cancellation section sits apart from the rest of the
page.

-   You will be asked for a reason for cancelling, and asked to type
    your workspace name to confirm - this is a deliberate extra step to
    make sure cancellation is not accidental.

-   Cancelling does not end your access immediately - you keep full
    access through the end of your current paid billing period, shown on
    screen before you confirm.

-   None of your data is deleted when you cancel - all your records stay
    exactly as they are and are fully available again the moment you
    resubscribe.

To come back after cancelling, use Change Plan on the Billing Settings
page at any time (even before your access period ends) to start a fresh
subscription.

# **Section 15 --- Data Security & Privacy**

Your workspace's data is fully isolated from every other organization
on the platform:

-   Your employees, customers, financial records, and settings are
    visible only to users within your own workspace.

-   Even Davors Facilities' own platform administrators cannot see your
    workspace's day-to-day data through the application --- platform
    administration is limited to account-level actions such as
    activating your subscription.

-   Every user must log in with their own email and password; there is
    no shared or generic login. Users who enable multi-factor
    authentication (MFA) under My Account confirm a second factor at
    login when their account requires it.

+-----------------------------------------------------------------------+
| **Note**                                                              |
|                                                                       |
| If you ever notice information in your workspace that does not belong |
| to your organization, stop using that screen and contact support      |
| immediately.                                                          |
+-----------------------------------------------------------------------+

# **Section 16 --- Getting Help**

If you run into an issue or have a question not covered in this
handbook:

  **Step**   **What to do**
  ---------- ----------------------------------------------------------------
  1          First, check with your own workspace Admin --- many day-to-day
             questions (password resets, new user setup, role changes) can be
             resolved directly by them.

  2          For anything else, use Administration → Report a Problem if
             you are an Admin, or contact the Davors Facilities support
             team through the WordPress site at davorsfacilities.com or
             your usual Davors contact.

When reporting an issue, it helps to include: your workspace name, the
page you were on, what you expected to happen, and what happened
instead.

# **Section 17 --- Worked Example: A Day in Your Business**

To bring everything together, here is a complete example: a
wholesale-to-retail business that buys assorted drinks and biscuits at a
warehouse, and sells them retail, while tracking fuel, packaging, and
worker costs.

*Fig. 5 --- The full loop, from purchase to profit.*

## **Step 1 --- Set up once**

-   Inventory → Suppliers: add the warehouse(s) you buy from

-   Inventory → Finished Products: create each item, mark Sourcing as
    Purchased, set your selling price --- do not enter a standing master
    cost here; cost comes from purchases and adjustments for the
    business unit you are working in

## **Step 2 --- Buying stock at the warehouse**

Inventory → Purchases → Record Purchase: product, supplier, quantity,
actual cost paid, payment method (on the correct business unit). This
increases stock and, for a cash purchase, reduces your cash position
with no debt created.

## **Step 3 --- Running costs (fuel, packaging, workers)**

These are not inventory --- they are operating expenses. Finance →
Expense Register for fuel and packaging. Formal wages run through HR
Management → Payroll; informal day labour can be logged as an expense
too.

## **Step 4 --- Selling at the end of the day**

Sales & CRM → POS: add items to a cart, checkout, print a receipt. Stock
and Cost of Goods Sold are calculated automatically using the real price
you paid at the warehouse.

## **Step 5 --- Seeing your actual profit**

-   Dashboard: quick daily/monthly Net Profit, Revenue, Expenses, and
    Total Purchases at a glance

-   Finance → Profit & Loss: Revenue minus auto-calculated COGS minus
    operating expenses = actual profit

-   Finance → Cash Flow Statement: real cash in vs. cash out, separate
    from the accrual-based P&L

# **Section 18 --- Glossary of Terms**

  **Term**           **Meaning**
  ------------------ ----------------------------------------------------
  Workspace / Tenant Your organization's private area within the Davors
                     Facilities ERP

  Admin              The role with full access to your workspace,
                     including Administration

  POS                Point of Sale --- the in-person, cart-based checkout
                     screen for product sales

  Purchase Order     An optional plan to buy stock from a supplier,
  (PO)               before it has arrived

  Purchase           The actual recorded event of stock arriving and (if
                     on credit) money being owed

  Sourcing Type      Whether a Finished Product is Manufactured (made
                     in-house) or Purchased (bought for resale)

  COGS               Cost of Goods Sold --- the cost of stock
                     automatically expensed at the moment it is sold

  Weighted Average   The automatically calculated cost per unit for a
  Cost               product or material in a business unit, blended from
                     production and/or purchases, reduced by sale COGS and
                     internal consumption, and including manual stock
                     adjustments

  Business Unit      A named business under one workspace (for example
                     Logistics vs Facilities), selected from the switcher;
                     stock and many records are kept per unit

  All Businesses     Switcher mode that shows combined data across every
                     business unit; you cannot create or stamp new records
                     in this mode

  Stock Adjustment   Manual quantity change (Opening Balance, Found Stock,
                     Correction, Write-off) on Raw Materials or Finished
                     Products for the active business unit

  Fixed Asset        Equipment, vehicles, or property kept and used
                     long-term, tracked separately from Inventory

  PAYE               Pay As You Earn --- statutory income tax deducted
                     from payroll

  SSNIT              Social Security and National Insurance Trust
                     contributions

  Trial              The 90-day period of free full access given to a new
                     workspace

  Tier               A subscription plan (Starter, Professional,
                     Business, Enterprise) determining which modules are
                     unlocked

  Client Invoice     A contract-based invoice you issue to your own
                     customer, generated and tracked from Finance →
                     Client Invoices

  Authorized By      The named signer and title printed on a Client
                     Invoice's signature line

  Payment Account    A saved bank or mobile money profile that can be
                     selected to appear on your Client Invoices

  VAT/NHIL/GETFund   Combined statutory tax (20%) applied to service
                     income on Client Invoices

  WHT                Withholding Tax (7.5%) --- shown for disclosure on
                     Client Invoices, not subtracted from the amount due

  Campaign           A one-time or scheduled marketing message sent to a
                     chosen group of your customers, from Email &
                     Promotions

  Notification Rule  An automatic customer-facing message triggered by a
                     real event (a sale, a payment, an invoice),
                     configured under the Notification Rules tab

  Customer Portal    The login area for your Client-role customers to see
                     their invoices, receipts, and related documents

# **Section 19 --- AI Assistant**

A built-in chat assistant is available inside the ERP, for questions
about your own data or how to do something in the system.

Ask it things like "what's my outstanding balance for Central
University" or "how do I raise a purchase order" --- it can look up your
own workspace data and explain how a feature works.

It answers from two sources: this handbook (retrieved by topic) and live
read-only tools that pull figures from your workspace. It only ever sees
data your own account already has access to --- the same role-based
access that applies to the rest of the ERP applies to what it can
answer.

It answers questions and points you to the right screen --- it does not
create, edit, or delete records on your behalf. Any change still has to
be made by you, the normal way.
