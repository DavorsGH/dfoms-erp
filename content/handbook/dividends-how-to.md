# Dividends — how to declare and pay

## Who can do this

Only **Directors** and **Administrators** (super_admin) can manage shareholders, declare dividends, record payments, or cancel a declaration. Finance and other roles can view statutory tax but cannot use the Dividends board.

Open **Directors** in the sidebar, then **Shareholders** or **Dividends**.

## Before you declare

1. **Shareholders must total 100%.** On **Shareholders**, active share percentages must add up to exactly 100%. Inactive shareholders are ignored.
2. **Pick one business unit.** Dividends are declared for a single business unit — not "All businesses".
3. **Check retained earnings.** Gross dividend cannot exceed retained earnings for that unit as of the declaration date.
4. **Use the scorecard checklist.** On **Directors → Scorecard**, all five "Ready to pay a dividend?" checks should be **Done** before you declare. See the Director's Scorecard how-to for what each check means.

## Declare a dividend

1. Go to **Directors → Dividends**.
2. Click **Declare dividend** (or save a **draft** first if you want to review lines before declaring).
3. Choose the **business unit**, **declaration date**, **period** (start/end), and **gross amount**. The system splits gross, WHT, and net across shareholders by share %.
4. Click **Declare**. If the scorecard shows warnings (for example overdue statutory payments), confirm when prompted.
5. Declaring creates an **open WHT payable** row on the Statutory Ledger for dividend withholding tax.

Drafts can be edited or deleted. Once declared, the dividend number and lines are fixed except for recording payments or cancellation (see below).

## Pay shareholders

After declaration, each line shows the shareholder's **full net** amount.

1. On **Directors → Dividends**, open the declaration and click **Record payment** on a line.
2. Enter **payment date**, **method** (bank, MoMo, cash, or cheque), and an optional **reference**.
3. The **net payment** is read-only — each line is paid in **one full payment** (no partial amounts).
4. When every line is paid, the declaration status becomes **Paid**.

Record the actual bank or MoMo outflow in your usual cash records if needed; the dividend payment updates dividends payable on the Balance Sheet.

## Remit dividend WHT

Dividend WHT is remitted like other WHT — **Finance → Statutory Ledger**, remit the open WHT leg for the period (or the dividend leg only). Use the remittance date as the day cash left the bank.

## Cancel a declared dividend

You may cancel only if:

- The declaration is still **Declared** (not paid),
- **No shareholder payments** have been recorded, and
- Dividend **WHT has not been remitted** on the Statutory Ledger.

Click **Cancel**, enter a **reason** (required), and confirm. Cancellation reverses the open dividend WHT tax row.

## Things to know

- Declaration and payment are **atomic** in the database — you will see a plain-English error in a dialog if something is not allowed (for example a second payment on the same line).
- Planning figures on the scorecard are not tax advice; declared dividends are real ledger entries.
