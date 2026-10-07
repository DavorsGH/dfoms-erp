# Double-entry manual duplication audit (read-only)

Screens where the same economic event can be recorded twice if the user also uses another register or manual line. Use this list for training and future consolidation — not fixed in Part 2.

## Finance

| Screen | Path | Duplication risk |
|--------|------|------------------|
| Expense Register | Finance → Expense Register | Paid expenses vs AP settlement vs inventory cash purchases |
| Director's Loan ledger | Manual Financial Entries → Director's Loan | Personal expenses posted as company expenses; manual `loan_proceeds` / `loan_repayments` vs ledger cash |
| Manual Financial Entries (monthly row) | Finance → Manual Financial Entries | Stock fields vs registers (directors loan, bank loans, cash opening) |
| Staff Welfare disbursement | Finance → Staff Welfare Fund | Disbursement linked to expense receipt vs duplicate cash expense |
| Income Register | Finance → Income Register | Client invoice / POS income vs manual income lines |
| Accounts Payable + AP Payments | Finance → Accounts Payable | AP accrual plus separate paid expense for same vendor invoice |

## HR / Payroll

| Screen | Path | Duplication risk |
|--------|------|------------------|
| Payroll Processing → Salary Advance (legacy manual) | HR → Payroll Processing | Manual `salary_advance` on row vs **Loans & Advances** register (Part 2 register is source of truth for open months) |
| Loans register vs salary advance | HR → Loans & Advances | Loans (repayment schedule) vs salary advances (one-off deduct month) — different products, not duplicate |
| Overtime Register vs payroll row | HR → Overtime | Overtime amounts flow to payroll; do not re-key in bonuses |

## Inventory

| Screen | Path | Duplication risk |
|--------|------|------------------|
| Raw / FP purchases (cash) | Inventory purchases | Cash inventory vs expense register |
| Internal consumption | Inventory → Internal Consumption | Consumption vs manual inventory adjustment |

## Recommended guardrails (future)

- Prefer register-first flows (advances, director loan, AP payments, invoice payments).
- Block or warn when receipt numbers / source IDs collide.
- Dashboard balance check should stay on one shared BS builder (see parity audits under `scripts/audits/`).
