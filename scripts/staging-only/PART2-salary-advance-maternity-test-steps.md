# PART 2 — Salary advance & maternity (staging test steps)

**Workspace:** Caanta only — tenant `61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b`  
**Do not run on Davors Facilities or production.**

## Prerequisites

1. Apply migrations on staging (order matters):

   ```bash
   npx tsx scripts/staging-only/apply-PART2-salary-advance-maternity-staging.ts
   ```

2. Restart local dev: `npm run dev`
3. Sign in to staging with a Caanta HR/finance user.

---

## A) Salary advances

### A1 — Issue advance (cash + receivable)

1. HR → **Loans & Advances**
2. **Add Salary Advance**
3. Select **two employees**, amount **GHS 100.00** each, date issued **today**, deduct month **current open payroll month**, choose **Paid from** account, **Approved by**
4. Save
5. Finance → **Balance Sheet** (Caanta BU, month of date issued):
   - **Staff Advances Receivable** increases by **GHS 200.00**
   - **Cash** decreases by **GHS 200.00**
   - Balance check **balanced** (within tolerance)

### A2 — Payroll pick-up

1. HR → **Payroll Processing** → same deduct month
2. Expand an employee with an outstanding advance
3. **Salary Advance** is **read-only**; tooltip **Comes from Loans & Advances**
4. Amount matches register total for that employee/month

### A3 — Lock / reopen

1. **Partial or full lock** payroll for that month
2. Register: advances show **Deducted**; edit/delete **blocked** (amber tooltip)
3. BS: receivable for those advances **clears** for that month end; still **balanced**
4. **Reopen** payroll
5. Advances return to **Outstanding**; receivable restored; BS still **balanced**

### A4 — Edit / delete outstanding

1. With payroll **open**, edit an outstanding advance amount → BS updates
2. Delete an outstanding advance → cash and receivable reverse; BS **balanced**

### A5 — Locked deduct month

1. Try to set **deduct month** to a **locked** payroll month on create/edit
2. Expect friendly error from RPC

---

## B) Maternity leave

### B1 — Leave types on HR Leave register

1. HR → **Leave**
2. Leave type dropdown lists rows from **leave_types** (includes **Maternity Leave** after migration 374), not the old hardcoded Compassionate-only list

### B2 — Absence vs maternity

1. For an employee with **Approved Maternity Leave** covering dates in the payroll month:
2. Mark those dates **Absent** on attendance (if present in test data)
3. Payroll **absence deduction** should **not** count those days (compare before/after maternity approval on same attendance)

---

## Regression

- `npx tsc --noEmit`
- `npm run build`

## Rollback (staging only)

Drop `salary_advance_register` and restore prior `_payroll_deduction_savings_total` / lock finance functions from migration 292 backup — only if directed; not automated here.
