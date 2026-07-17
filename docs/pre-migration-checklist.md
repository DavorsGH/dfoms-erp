# Pre-Migration Regression Checklist

**Branch:** `multi-tenant-foundation`  
**Baseline snapshot date:** 17 July 2026  
**Reference period:** July 2026 (financial year 2026)  
**Purpose:** After Phase 1 (tenant_id + RLS) ships, every item below must produce identical output to this baseline.

> Figures below were captured live from the production Supabase database on 17 July 2026.  
> Currency: GHS unless stated otherwise.

---

## Finance Reports

Route prefix: `/dashboard/reports/finance/`

| # | Report | Route | Baseline — correct July 2026 output |
|---|--------|-------|-------------------------------------|
| 1 | **Monthly P&L Statement** | `monthly-pl` | July 2026 revenue **GHS 0.00** (0 income entries dated in July); total expenses **GHS 19,399.16** across 17 entries; largest lines: Staff Salaries/Payroll **GHS 14,665.51**, Direct Operational supplies/materials/fuel **GHS 3,826.00**, Employer SSNIT **GHS 791.25**; July depreciation expense **GHS 418.43**; net result **loss of GHS 19,817.59** (expenses + depreciation, no July revenue). |
| 2 | **Monthly Balance Sheet** | `monthly-balance-sheet` | As at 31 Jul 2026: Accounts Receivable **GHS 18,004.64** (1 invoice); Fixed Assets NBV **GHS 6,142.14** (19 assets, accumulated depreciation **GHS 836.86**); manual-entry positions — Cash on Hand **GHS 0.00**, Bank Balance **GHS 0.00**, Share Capital **GHS 21,379.74**, VAT Payable **GHS 2,092.04**; total capital contributions cumulative **GHS 28,396.92**; balance sheet must reconcile (assets = liabilities + equity within GHS 0.01 tolerance). |
| 3 | **Cash Flow Statement** | `cash-flow` | July 2026 cash inflows from receipts **GHS 0.00**; cash outflows from paid expenses **GHS 3,942.40**; manual entry for period `2026-07-01` shows opening cash **GHS 0.00**, no loan activity, no fixed-asset purchases recorded. |
| 4 | **Accounts Receivable Aging** | `ar-aging` | **1 open invoice**: `INV-2026-06-001` — Central University, Commercial Cleaning, invoice date 30 Jun 2026, due **31 Jul 2026**, amount **GHS 18,004.64**, received **GHS 0.00**, outstanding **GHS 18,004.64**, bucket **Current (not yet due)** as of 17 Jul 2026. |
| 5 | **Statutory Liabilities Report** | `statutory-liabilities` | **4 unpaid payables** totaling **GHS 3,639.85**: SSNIT June correction **GHS 962.10** (due 14 Jul), GRA/PAYE June correction **GHS 771.71** (due 14 Jul), SSNIT July `PAYROLL-SSNIT-2026-07` **GHS 1,126.01** (due 14 Aug), GRA/PAYE July `PAYROLL-GRA-2026-07` **GHS 780.03** (due 14 Aug); plus VAT Payable from manual entry **GHS 2,092.04** (July period). |
| 6 | **Fixed Asset & Depreciation Schedule** | `fixed-asset-schedule` | **19 fixed assets**, total original cost **GHS 6,979.00**; as at 31 Jul 2026 accumulated depreciation **GHS 836.86**, net book value **GHS 6,142.14**; July monthly depreciation charge **GHS 418.43**. |
| 7 | **Capital Contributions Summary** | `capital-contributions` | **5 entries** cumulative **GHS 28,396.92** through 31 Jul 2026; July-specific contributions: **GHS 1,986.00** (9 Jul, operational expenses) and **GHS 1,956.40** (14 Jul, shortfall true-up), both by EMP0001. |
| 8 | **Expense Report** | `expense-report` | July 2026: **17 expense entries**, total **GHS 19,399.16**; breakdown matches P&L expense lines (Payroll GHS 14,665.51, Cleaning Supplies GHS 1,640.00, Cleaning Materials GHS 1,091.00, Fuel GHS 800.00, Employer SSNIT GHS 791.25, Uniforms GHS 275.00, Casual Labour GHS 120.00, Bank Charges GHS 16.40). |

---

## HR & Payroll Functions

Route prefix: `/dashboard/hr-payroll/`

| # | Function | Route | Baseline — correct July 2026 output |
|---|----------|-------|-------------------------------------|
| 1 | **Payroll run (processing)** | `payroll-processing` | July 2026 (`2026-07-01`) shows **21 employees**; totals — Gross Pay **GHS 14,665.51**, Employee SSNIT **GHS 334.76**, PAYE **GHS 780.03**, Net Pay **GHS 13,550.72**; top earner EMP0002: gross **GHS 1,400.00**, net **GHS 1,200.72**; month-end close record shows **Partially Locked** status with note "Mid-month lock, full month's days recorded". |
| 2 | **Payslip generation** | `payslip` | July 2026 period selectable; EMP0002 payslip shows gross **GHS 1,400.00**, employee SSNIT **GHS 77.00**, PAYE **GHS 122.28**, net **GHS 1,200.72**; all 21 employees have payroll_history rows for `2026-07-01`. |
| 3 | **SSNIT / PAYE calculation** | (within payroll-processing) | July totals: employee SSNIT **GHS 334.76**, employer SSNIT (expense) **GHS 791.25**, combined SSNIT payable **GHS 1,126.01**; PAYE withheld **GHS 780.03**; rates sourced from `ssnit_rate_config` and `paye_tax_bands` tables (7 bands). |
| 4 | **Attendance import** | `attendance` (bulk import modal) | July 2026 attendance: **240 records** across **20 employees** — **212 Present**, **4 Absent**; bulk import accepts Excel/CSV and classifies rows as ready/duplicate/error without corrupting existing records. |
| 5 | **Payroll history** | `payroll-history` | Locked/historical view includes July 2026 rows for 21 employees with same totals as processing screen. |
| 6 | **Attendance register** | `attendance` | CRUD on daily records; July data matches counts above. |

---

## Operations Screens

Route prefix: `/dashboard/operations/`

| # | Screen | Route | Baseline — correct output (July 2026 context) |
|---|--------|-------|-----------------------------------------------|
| 1 | **Duty Roster** | `duty-roster` | **1 roster config** active; rotation view shows client facility table with Morning/Afternoon shifts, supervisor assignments, and staff-assigned percentage; "Start New Rotation" API functional; **0 roster_history** audit rows currently. |
| 2 | **Work Orders** | `work-orders` | **0 work orders** total (0 dated in July 2026); CRUD form accepts checklist, client/site, cleaner, inspection score; Pass/Fail threshold ≥ 70%. |
| 3 | **Inspection Summary** | `inspection-summary` | **1 inspection** on record (0 dated in July 2026); table columns: Inspection Date, Client, Site, Supervisor, Score %, Pass/Fail, Status. |
| 4 | **Complaint Register** | `complaint-register` | **1 complaint** on record (0 received in July 2026); columns: Date Received, Client, Site, Details, Priority, Status, Repeat Complaint. |
| 5 | **Incident Register** | `incident-register` | **4 incidents** on record (0 dated in July 2026); columns: Date, Client, Site, Description, Severity, Status, Escalated. |
| 6 | **Clients** | `clients` | **3 clients**: Central University (CL-001, Active), Davors Facilities (CLI002, Active), University of Ghana Medical Center (CLI003, Pending). |
| 7 | **Sites** | `sites` | **5 sites**: Students Centre [Plaza] (SI-001), CU Students' Girls Hostel (SI-002), Trinity Hall (SI-003), Basement (SI-004) — all CL-001; Davors Office (SI-005) — CLI002. |

---

## Regression Test Protocol

After Phase 1 migration:

1. Log in as an admin user with full module access.
2. Open each Finance report, select **July 2026**, and compare totals to the figures in this document.
3. Run payroll processing for July 2026 and verify employee-level and summary totals.
4. Generate payslip for EMP0002 (July 2026) and verify line items.
5. Open each Operations screen and verify row counts and key field values.
6. Import a small attendance test file and confirm duplicate detection still works.
7. Flag any deviation > GHS 0.01 (finance) or any missing/changed row (operations/HR) as a regression.

---

## Snapshot Metadata

| Field | Value |
|-------|-------|
| Database tables inventoried | 78 |
| Total employees | 25 |
| Active payroll (July 2026) | 21 |
| Income register entries | 1 |
| Expense register entries | 59 |
| User accounts | 6 |
| Snapshot captured | 2026-07-17 |
