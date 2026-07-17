# Schema Inventory — Pre-Migration

**Branch:** `multi-tenant-foundation`  
**Snapshot date:** 17 July 2026  
**Database:** Supabase `public` schema  
**Purpose:** Checklist of every table that will need `tenant_id` added in Phase 1.

Row counts are exact `COUNT(*)` values captured live on 17 July 2026.

---

## Summary

| Metric | Count |
|--------|------:|
| Total tables | 78 |
| Tables with data | 48 |
| Empty tables | 30 |
| Total rows (all tables) | 1,518 |

---

## Table Inventory

| Table | Rows | Description |
|-------|-----:|-------------|
| `accounts_payable` | 4 | Vendor invoices and statutory payables (SSNIT, GRA/PAYE) with payment status |
| `action_status_options` | 3 | Lookup values for corrective action workflow statuses |
| `approvers` | 2 | Configured approvers for leave and other approval workflows |
| `asset_categories` | 3 | Fixed asset category master list |
| `asset_register` | 0 | Legacy/unused asset register (superseded by `fixed_assets`) |
| `attendance_register` | 520 | Daily employee attendance records (clock in/out, status) |
| `capital_contributions` | 5 | Owner/shareholder capital injection entries |
| `casual_tax_rate_config` | 1 | Flat tax rate configuration for casual workers |
| `clients` | 3 | Client master data (contact, contract, supervisor) |
| `complaint_priority_options` | 3 | Lookup values for complaint priority levels |
| `complaint_register` | 1 | Client complaint records with priority and resolution status |
| `consumables` | 0 | Consumables inventory (unused) |
| `contract_status_options` | 3 | Lookup values for client contract statuses |
| `corrective_actions` | 1 | Corrective action records linked to failed inspections |
| `departments` | 6 | Organizational department master list |
| `depreciation_methods` | 2 | Depreciation method options (e.g. straight-line) |
| `disciplinary_records` | 0 | Employee disciplinary action records (unused) |
| `employee_employment_history` | 25 | Employment history/contract records per employee |
| `employee_leave_balances` | 75 | Per-employee leave entitlement balances by leave type |
| `employees` | 25 | Employee master records (staff ID, salary, contract, position) |
| `equipment_register` | 0 | Equipment tracking register (unused) |
| `equipment_status_options` | 3 | Lookup values for equipment statuses |
| `exit_management` | 0 | Employee exit/offboarding records (unused) |
| `expense_categories` | 5 | Top-level expense category master (COGS, Admin, etc.) |
| `expense_register` | 59 | Expense transactions with category, payment status, amount |
| `expense_subcategories` | 26 | Expense sub-category master linked to categories |
| `failed_inspections` | 0 | Failed inspection records triggering corrective actions |
| `finished_products` | 0 | Finished product inventory items (unused) |
| `fixed_assets` | 19 | Fixed asset register with cost, depreciation method, useful life |
| `incident_register` | 4 | Operational incident records (severity, escalation) |
| `incident_type_options` | 4 | Lookup values for incident types |
| `income_register` | 1 | Revenue/income entries including service invoices and product sales |
| `inspection_result_options` | 3 | Lookup values for inspection pass/fail results |
| `inspection_summary` | 1 | Site inspection records with scores and supervisors |
| `internal_consumption` | 0 | Internal product consumption tracking (unused) |
| `inventory_balance_config` | 1 | Go-live date and opening inventory value for balance sheet |
| `leave_approver_config` | 1 | Configuration for leave approval routing |
| `leave_management` | 0 | Legacy leave management table (unused) |
| `leave_requests` | 6 | Employee leave request submissions and approval status |
| `leave_types` | 3 | Leave type definitions (annual, sick, etc.) |
| `loan_register` | 0 | Employee loan records (unused) |
| `manual_financial_entries` | 1 | Manual balance-sheet and cash-flow adjustments per period |
| `month_end_close` | 2 | Payroll period lock status and net-pay totals per month |
| `month_end_close_backup_20260713c` | 0 | One-off backup table from July 2026 migration (empty) |
| `operations_config` | 1 | Operations module configuration (pass/fail threshold, defaults) |
| `overtime_register` | 0 | Employee overtime hour records (unused) |
| `pay_rate_structure` | 0 | Legacy pay rate structure (unused) |
| `paye_bands` | 7 | Legacy PAYE tax band configuration |
| `paye_config` | 1 | PAYE tax configuration header |
| `paye_tax_bands` | 7 | Progressive PAYE tax band rates and thresholds |
| `payment_methods` | 5 | Payment method master list |
| `payroll_history` | 41 | Locked payroll calculation rows per employee per month |
| `payroll_history_backup_20260713c` | 0 | One-off backup table from July 2026 migration (empty) |
| `payroll_link` | 0 | Payroll linkage/reference table (unused) |
| `payroll_processing` | 62 | In-progress payroll calculation rows (editable periods) |
| `positions` | 11 | Job position/title master list |
| `production_batch_materials` | 0 | Raw materials consumed per production batch (unused) |
| `production_batches` | 0 | Production batch records (unused) |
| `projects` | 7 | Client project/contract codes for roster and payroll assignment |
| `raw_material_purchases` | 0 | Raw material purchase transactions (unused) |
| `raw_materials` | 0 | Raw material inventory items (unused) |
| `recruitment_tracker` | 0 | Recruitment pipeline records (unused) |
| `risk_level_options` | 3 | Lookup values for site risk levels |
| `roles` | 7 | RBAC role definitions with page-level permissions |
| `roster_config` | 1 | Active duty roster rotation configuration per client |
| `roster_history` | 0 | Audit log of employee rotation changes between sites |
| `salary_rate_config` | 5 | Position-based salary rate configuration |
| `service_types` | 9 | Service type master for income register and contracts |
| `severity_options` | 3 | Lookup values for incident severity levels |
| `sites` | 5 | Cleaning site master data linked to clients/projects |
| `ssnit_config` | 1 | Legacy SSNIT configuration header |
| `ssnit_rate_config` | 1 | SSNIT contribution rates and insurable earnings ceiling |
| `ssnit_rates` | 5 | Legacy SSNIT rate tiers |
| `stock_movements` | 0 | Inventory stock movement ledger (unused) |
| `todos` | 0 | Internal todo/task tracking (unused) |
| `user_account_supervisor_sites` | 1 | Maps supervisor user accounts to assigned sites (RBAC) |
| `user_accounts` | 6 | Application user accounts linked to auth, employees, or clients |
| `work_orders` | 0 | Cleaning work order records with inspection scores |

---

## Phase 1 Scope Notes

### Tables requiring `tenant_id` (all data-bearing tables)

Every table in the inventory above except:

- **Backup tables** (`*_backup_*`) — candidates for removal rather than migration
- **Legacy/unused empty tables** — still need `tenant_id` if retained, or drop in a cleanup pass

### Lookup / config tables (shared vs per-tenant decision needed)

These small reference tables may be duplicated per tenant or shared globally:

- `action_status_options`, `complaint_priority_options`, `contract_status_options`
- `depreciation_methods`, `equipment_status_options`, `incident_type_options`
- `inspection_result_options`, `risk_level_options`, `severity_options`
- `expense_categories`, `expense_subcategories`, `payment_methods`
- `departments`, `positions`, `service_types`, `leave_types`
- `paye_tax_bands`, `ssnit_rate_config`, `casual_tax_rate_config`, `salary_rate_config`
- `roles` (RBAC — likely per-tenant)
- `operations_config`, `inventory_balance_config`, `leave_approver_config`

### High-volume tables (priority for index planning)

| Table | Rows | Notes |
|-------|-----:|-------|
| `attendance_register` | 520 | Daily records; heavy read during payroll |
| `employee_leave_balances` | 75 | 25 employees × 3 leave types |
| `payroll_processing` | 62 | Grows monthly with each payroll run |
| `expense_register` | 59 | Grows with each expense entry |
| `payroll_history` | 41 | Locked payroll archive |

### Tables with cross-module foreign keys

These tables link multiple modules and need careful `tenant_id` backfill ordering:

- `employees` → referenced by attendance, payroll, roster, leave, user_accounts
- `clients` / `sites` / `projects` → referenced by operations, roster, income, payroll
- `income_register` / `expense_register` → referenced by finance reports and balance sheet
- `payroll_history` / `payroll_processing` → referenced by payslip, month_end_close, finance lock
- `user_accounts` → referenced by RBAC, self-service, supervisor site mapping

---

## Snapshot Query

Row counts were generated with:

```sql
SELECT c.relname AS table_name,
       (xpath('/row/cnt/text()',
         query_to_xml(format('SELECT COUNT(*) AS cnt FROM %I.%I', n.nspname, c.relname),
           false, true, '')))[1]::text::bigint AS row_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
```
