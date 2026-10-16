# Director's Scorecard — how to read it

## What it is

The Director's Scorecard is a planning view for company directors. It answers three questions for a month:

1. How much profit did we make?
2. How much of it must be kept aside for tax, and how should the rest be shared?
3. Is it safe to pay owners a dividend now?

It is read-only — it does not change any records. The figures are planning figures, not tax advice.

## Who can see it and where

- Visible to **Directors** and **Administrators** only. Other roles (including Finance) do not see it.
- It is on the **Dashboard**, below the summary cards.
- It follows the **Summary Month** selected on the Dashboard and the **business unit** selected in the header. In "All businesses", transfers between your own business units are left out so nothing is counted twice.

## The figures

| Tile | What it means |
|------|---------------|
| **Revenue** | Income for the month, excluding VAT. Matches Total Revenue on the Profit & Loss report. |
| **Total costs** | All costs for the month, including depreciation. Matches Total Expenses on the Profit & Loss report. |
| **Profit before tax** | Revenue minus total costs. Matches Net Profit on the Profit & Loss report. |
| **Tax to set aside** | Corporate income tax (25% of profit) plus Growth & Sustainability Levy (2.5% of profit), minus withholding tax that clients have already deducted from your invoices in the month (the WHT credit). This is the cash to keep aside for tax. Zero when there is no profit. |
| **Profit after tax** | Profit before tax minus corporate income tax and the levy. Shown with a suggested split: **30% Reserve**, **20% Reinvest**, **50% Owners**. |
| **Dividend available this quarter** | 50% of the quarter's profit after tax so far (loss months reduce it), minus 8% dividend withholding tax. Shows gross, WHT and net. Zero when the quarter has no profit. |

### Profit is not the same as cash

Profit counts income when you **invoice** and costs when they are **incurred** — even if the client has not paid yet, or you have not yet paid PAYE/SSNIT. So you can show a good profit while the bank balance is low. Unpaid client invoices sit as money owed to you; unpaid PAYE and SSNIT sit as liabilities. Check **Finance → Balance Sheet** to see where the money is.

## Budget vs actual

The scorecard lists each budget line for the month with Budget, Actual, Variance, Remaining and status (**On track**, **Near limit**, **Over budget**). Click a line name to open the Expense Register filtered to that category and month. Use **Open Budget vs Actual report** for the full report.

## "Ready to pay a dividend?"

Five checks must all be **Done** before paying a dividend. Each one has a link to where you deal with it.

| Check | Done when | Link |
|-------|-----------|------|
| **Client invoices paid** | All client invoices for the quarter are paid. Unpaid invoice numbers are listed. | Each invoice number; **Record payment →** opens unpaid invoices |
| **GRA and SSNIT payments** | No PAYE, SSNIT, VAT or WHT payments are past their due date. Shows **Overdue** (red) when a deadline has passed. | **Pay or record →** opens the Statutory Ledger |
| **Cash cushion of one month's payroll** | Cash covers at least one month of payroll. Shows how much more is needed. | **View cash position →** opens the Balance Sheet |
| **Books balance** | The Balance Sheet is balanced. | **View Balance Sheet →** (or **Check Balance Sheet →** when not balanced) |
| **Enough cash after the dividend** | After paying the dividend and keeping the tax aside, cash still covers next payroll. | **View cash position →** |

Status labels: **Done** (green), **To do** (amber), **Overdue** (red).

When everything is Done the banner says **"Ready — all checks complete. You can declare a dividend."** Otherwise it shows **"Not yet —"** with counts such as **"1 done · 3 to do · 1 overdue"**. Overdue checks stay visible even when the checklist is collapsed.

## The order to fix things

1. Collect unpaid client invoices and record the payments.
2. Pay overdue PAYE and SSNIT (and VAT/WHT) and record them in the Statutory Ledger — penalties build up every month they are late.
3. Build the cash cushion from the Reserve share of profit.
4. When all checks are Done, a dividend is safe to declare.

## Things to know

- Rates used: CIT 25%, GSL 2.5%, dividend WHT 8%; profit split 30/20/50. These are fixed for now.
- The scorecard does not record a dividend. Paying and recording a dividend is done outside the scorecard.
