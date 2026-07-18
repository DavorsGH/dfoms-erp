# Phase 1 — Application Query Audit

**Branch:** `multi-tenant-foundation`  
**Date:** 17 July 2026  
**Scope:** Every Supabase table/RPC call in application code that will need `tenant_id` awareness once script 60 RLS is enforced.

**Legend**

| Flag | Meaning |
|------|---------|
| **RLS** | Uses publishable key; RLS applies after script 60 |
| **SR** | Uses `createAdminClient()` / service role — bypasses RLS but must still set `tenant_id` on writes |
| **RPC** | Postgres function; may need tenant guards inside SQL (follow-up migration) |

**Note:** Explicit `.eq('tenant_id', …)` filters are optional once RLS is active (defense in depth). **Inserts/upserts must include `tenant_id`** unless the `enforce_row_tenant_id` trigger fills it from session context.

---

## Summary counts

| Category | Files | Approx. call sites |
|----------|------:|-------------------:|
| Dashboard pages / components | 95+ | 350+ |
| API routes | 15 | 45+ |
| Shared utils | 8 | 20+ |
| Maintenance scripts | 3 | 15+ |

**Tables touched by app code:** 45 of 78 inventory tables (others are unused or RPC-only).

---

## API routes

### `app/api/admin/users/create/route.ts` — **SR**
| Table | Operations |
|-------|------------|
| `user_accounts` | insert, delete (rollback) |

→ Must set `tenant_id` on new user_accounts rows.

### `app/api/admin/users/update/route.ts` — **SR**
| Table | Operations |
|-------|------------|
| `user_accounts` | select, update |

### `app/api/admin/users/deactivate/route.ts` — **SR**
| Table | Operations |
|-------|------------|
| `user_accounts` | select, update |

### `app/api/admin/users/reset-password/route.ts` — **SR**
| Table | Operations |
|-------|------------|
| `user_accounts` | select |

### `app/api/hr-payroll/lock-period/route.ts` — **SR**
| Table | Operations |
|-------|------------|
| `month_end_close` | select, upsert |
| `payroll_history` | select, update |
| `payroll_processing` | select, delete |

### `app/api/hr-payroll/release-period/route.ts` — **SR**
| Table | Operations |
|-------|------------|
| `month_end_close` | select, upsert |
| `payroll_history` | select |
| `payroll_processing` | select, delete |

### `app/api/hr-payroll/reopen-period/route.ts` — **SR**
| Table | Operations |
|-------|------------|
| `month_end_close` | select, upsert |
| `payroll_history` | select |
| `payroll_processing` | select, delete, insert |

### `app/api/hr-payroll/repair-period/route.ts` — **SR**
| Table | Operations |
|-------|------------|
| `month_end_close` | select |

### `app/api/operations/start-rotation/route.ts` — **SR**
| Table | Operations |
|-------|------------|
| `roster_config` | select, update |
| `employees` | select |
| `projects` | select |
| `sites` | select |
| `roster_history` | select, insert |

### `app/api/leave/submit/route.ts` — **RLS + RPC**
| Call | Operations |
|------|------------|
| `submit_leave_request` RPC | insert into `leave_requests`, update balances |

### `app/api/leave/approve/route.ts` — **RPC**
| Call | Operations |
|------|------------|
| `approve_leave_request` RPC | update `leave_requests`, `employee_leave_balances` |

### `app/api/leave/reject/route.ts` — **RPC**
| Call | Operations |
|------|------------|
| `reject_leave_request` RPC | update `leave_requests` |

### `app/api/leave/cancel/route.ts` — **RPC**
| Call | Operations |
|------|------------|
| `cancel_leave_request` RPC | update `leave_requests`, balances |

### `app/api/leave/change-approver/route.ts` — **RPC**
| Call | Operations |
|------|------------|
| `change_leave_approver` RPC | update `leave_approver_config` |

### `app/api/leave/adjust-balance/route.ts` — **RLS**
| Table | Operations |
|-------|------------|
| `employee_leave_balances` | upsert |

### `app/api/heartbeat/route.ts` — **SR**
| Table | Operations |
|-------|------------|
| `employees` | select |

---

## Shared utilities

### `middleware.ts` — **RLS**
| Table | Operations |
|-------|------------|
| `user_accounts` | select (is_active check) |

### `utils/dashboard-auth.ts` — **RLS**
| Table | Operations |
|-------|------------|
| `user_accounts` | select |
| `leave_requests` | select (approver check via RPC) |

### `utils/admin-auth.ts` — **SR**
| Table | Operations |
|-------|------------|
| `user_accounts` | select |

### `utils/current-user.ts` — **RLS**
| Table | Operations |
|-------|------------|
| `user_accounts` | select |
| `employees` | select |

### `utils/admin-user-delete.ts` — **SR**
| Table | Operations |
|-------|------------|
| `leave_approver_config` | select, delete |
| `user_accounts` | select, delete |
| `user_account_supervisor_sites` | delete |
| `leave_requests` | select, update |

### `utils/admin-user-role.ts` — **SR**
| Table | Operations |
|-------|------------|
| `user_account_supervisor_sites` | delete, insert |
| `user_accounts` | select, update |

### `utils/user-display.ts` — **RLS**
| Table | Operations |
|-------|------------|
| `employees` | select |
| `clients` | select |

### `utils/duty-roster-employees.ts` — **RLS + RPC**
| Call | Operations |
|------|------------|
| `get_duty_roster_employee_display` RPC | select from `employees` (patched in script 60) |

---

## Dashboard — Administration

| File | Tables | Operations |
|------|--------|------------|
| `administration/page.tsx` | `service_types` | select |
| `administration/approvers.tsx` | `approvers`, `employees` | select, insert, delete |
| `administration/approvers/page.tsx` | `approvers`, `employees` | select |
| `administration/asset-categories.tsx` | `asset_categories` | select, insert, delete |
| `administration/asset-categories/page.tsx` | `asset_categories` | select |
| `administration/depreciation-methods.tsx` | `depreciation_methods` | select, insert, delete |
| `administration/depreciation-methods/page.tsx` | `depreciation_methods` | select |
| `administration/expense-categories.tsx` | `expense_categories` | select, insert, delete |
| `administration/expense-categories/page.tsx` | `expense_categories` | select |
| `administration/expense-subcategories.tsx` | `expense_subcategories` | select, insert, delete |
| `administration/expense-subcategories/page.tsx` | `expense_subcategories` | select |
| `administration/payment-methods.tsx` | `payment_methods` | select, insert, delete |
| `administration/payment-methods/page.tsx` | `payment_methods` | select |
| `administration/projects.tsx` | `projects`, `sites` | select, insert, update, delete |
| `administration/projects/page.tsx` | `projects`, `sites`, `clients` | select |
| `administration/roster-settings.tsx` | `sites`, `roster_config` | select, insert, update |
| `administration/roster-settings/page.tsx` | `clients`, `roster_config`, `sites` | select |
| `administration/salary-rates.tsx` | `positions`, `salary_rate_config` | select, insert, update, delete |
| `administration/salary-rates/page.tsx` | `positions`, `salary_rate_config` | select |
| `administration/service-categories.tsx` | `service_types` | select, insert, delete |
| `administration/leave-settings/page.tsx` | `leave_approver_config`, `user_accounts` | select |

---

## Dashboard — Employees

| File | Tables | Operations |
|------|--------|------------|
| `employees/page.tsx` | `employees` | select |
| `employees/employees-directory.tsx` | `employees` | select, insert, update, delete |
| `employees/lookup-utils.ts` | `departments`, `projects`, `positions`, `sites`, `salary_rate_config`, `ssnit_rate_config`, `casual_tax_rate_config`, `paye_tax_bands` | select (dynamic table helper for lookups) |

---

## Dashboard — Finance

| File | Tables | Operations |
|------|--------|------------|
| `finance/page.tsx` | `income_register`, `service_types`, `clients` | select |
| `finance/accounts-payable.tsx` | `expense_categories`, `expense_subcategories`, `accounts_payable` | select, insert, update, delete |
| `finance/accounts-payable/page.tsx` | `accounts_payable`, `expense_categories`, `expense_subcategories` | select |
| `finance/capital-contributions.tsx` | `employees`, `capital_contributions` | select, insert, update, delete |
| `finance/balance-sheet/capital-contributions/page.tsx` | `capital_contributions`, `employees` | select |
| `finance/cash-flow/page.tsx` | `income_register`, `expense_register`, `manual_financial_entries` | select |
| `finance/expense-register.tsx` | `expense_categories`, `expense_subcategories`, `payment_methods`, `approvers`, `expense_register` | select, insert, update, delete |
| `finance/expenses/page.tsx` | `expense_register`, `expense_categories`, `expense_subcategories`, `payment_methods`, `approvers` | select |
| `finance/fixed-assets.tsx` | `asset_categories`, `depreciation_methods`, `fixed_assets` | select, insert, update, delete |
| `finance/fixed-assets/page.tsx` | `fixed_assets`, `asset_categories`, `depreciation_methods` | select |
| `finance/income-register.tsx` | `service_types`, `income_register` | select, insert, update, delete |
| `finance/manual-financial-entries.tsx` | `manual_financial_entries` | select, insert, update, delete |
| `finance/manual-financial-entries/page.tsx` | `manual_financial_entries` | select |
| `finance/product-sales.tsx` | `finished_products`, `income_register` | select; RPC `create_product_sale`, `void_product_sale` |
| `finance/product-sales/page.tsx` | `income_register`, `clients`, `finished_products` | select |
| `finance/profit-loss/page.tsx` | `income_register`, `expense_register`, `fixed_assets` | select |
| `finance/balance-sheet-page-data.ts` | `inventory_balance_config`, `raw_materials`, `finished_products`, `production_batches`, `raw_material_purchases`, `income_register`, `expense_register`, `fixed_assets`, `accounts_payable`, `capital_contributions`, `manual_financial_entries`, `payroll_history`, `payroll_processing`, `month_end_close` | select |
| `finance/payroll-lock-finance-utils.ts` | `expense_register`, `accounts_payable` | select, insert, update, delete (**SR** via admin param) |
| `reports/finance-report-data.ts` | `income_register`, `expense_register`, `fixed_assets`, `manual_financial_entries`, `accounts_payable`, `capital_contributions` | select |

---

## Dashboard — HR & Payroll

| File | Tables | Operations |
|------|--------|------------|
| `hr-payroll/attendance-register.tsx` | `attendance_register` | select, insert, update, delete |
| `hr-payroll/attendance/page.tsx` | `attendance_register`, `employees` | select |
| `hr-payroll/attendance-bulk-import.tsx` | `attendance_register` | insert |
| `hr-payroll/leave/page.tsx` | `leave_management`, `employees` | select |
| `hr-payroll/leave-management.tsx` | `leave_management` | select, insert, update, delete |
| `hr-payroll/leave-balances.tsx` | `employee_leave_balances` | select |
| `hr-payroll/leave-balances/page.tsx` | `employee_leave_balances`, `employees`, `leave_types` | select |
| `hr-payroll/loan-register.tsx` | `loan_register` | select, insert, update, delete |
| `hr-payroll/loans/page.tsx` | `loan_register`, `employees` | select |
| `hr-payroll/overtime-register.tsx` | `overtime_register` | select, insert, update, delete |
| `hr-payroll/overtime/page.tsx` | `overtime_register`, `employees`, `approvers` | select |
| `hr-payroll/payroll-processing.tsx` | `month_end_close`, `payroll_processing`, `payroll_history` | select, insert, update, delete, upsert |
| `hr-payroll/payroll-processing/page.tsx` | `payroll_processing`, `payroll_history`, `month_end_close`, `employees`, `attendance_register`, `overtime_register`, `loan_register`, `ssnit_rate_config`, `casual_tax_rate_config`, `paye_tax_bands` | select (**SR** server load) |
| `hr-payroll/payroll-history.tsx` | `month_end_close`, `payroll_history` | select |
| `hr-payroll/payroll-history/page.tsx` | `payroll_history`, `month_end_close`, `employees` | select |
| `hr-payroll/payroll-history-admin-utils.ts` | cascade RPCs + `payroll_history`, `payroll_processing`, `month_end_close` | delete, RPC (**SR**) |
| `hr-payroll/payslip.tsx` | `payroll_history`, `employees` | select |
| `hr-payroll/payslip/page.tsx` | `payroll_history` | select |
| `hr-payroll/staff-id-cards/page.tsx` | `employees` | select |
| `reports/hr-report-data.ts` | `employees`, `payroll_history`, `payroll_processing`, `month_end_close`, `attendance_register`, `leave_management`, `loan_register`, `overtime_register` | select |

---

## Dashboard — Operations

| File | Tables | Operations |
|------|--------|------------|
| `operations/clients.tsx` | `clients` | select, insert, update, delete |
| `operations/clients/page.tsx` | `clients`, `employees` | select |
| `operations/sites.tsx` | `sites` | select, insert, update, delete |
| `operations/sites/page.tsx` | `sites`, `clients`, `employees` | select |
| `operations/work-orders.tsx` | `work_orders` | select, insert, update, delete |
| `operations/work-orders/page.tsx` | `work_orders`, `clients`, `sites`, `employees`, `operations_config` | select |
| `operations/inspection-summary.tsx` | `inspection_summary` | select, insert, update, delete |
| `operations/inspection-summary/page.tsx` | `inspection_summary`, `clients`, `sites`, `work_orders`, `employees`, `operations_config` | select |
| `operations/failed-inspections.tsx` | `failed_inspections` | select, insert, update, delete |
| `operations/failed-inspections/page.tsx` | `failed_inspections`, `clients`, `sites`, `inspection_summary`, `employees` | select |
| `operations/corrective-actions.tsx` | `corrective_actions` | select, insert, update, delete |
| `operations/corrective-actions/page.tsx` | `corrective_actions`, `clients`, `work_orders`, `failed_inspections`, `employees` | select |
| `operations/complaint-register.tsx` | `complaint_register` | select, insert, update, delete |
| `operations/complaint-register/page.tsx` | `complaint_register`, `clients`, `sites`, `employees` | select |
| `operations/incident-register.tsx` | `incident_register` | select, insert, update, delete |
| `operations/incident-register/page.tsx` | `incident_register`, `clients`, `sites`, `employees` | select |
| `operations/duty-roster/page.tsx` | `clients`, `roster_config`, `projects`, `sites`, `roster_history` | select |
| `operations/roster-history/page.tsx` | `roster_history` | select |
| `operations-dashboard-utils.ts` | `clients`, `roster_config`, `employees`, `projects`, `sites`, `roster_history`, `corrective_actions`, `failed_inspections`, `work_orders`, `inspection_summary` | select |
| `reports/operations-report-data.ts` | `inspection_summary`, `failed_inspections`, `corrective_actions`, `complaint_register`, `incident_register`, `sites`, `clients`, `work_orders`, `roster_config`, `employees`, `projects`, `roster_history` | select |

---

## Dashboard — Inventory

| File | Tables | Operations |
|------|--------|------------|
| `inventory/finished-products.tsx` | `finished_products` | select, insert, update; RPC delete cascade |
| `inventory/finished-products/page.tsx` | `finished_products` | select |
| `inventory/raw-materials.tsx` | `payment_methods`, `raw_materials`, `raw_material_purchases` | select, insert, update; RPCs |
| `inventory/raw-materials/page.tsx` | `raw_materials`, `raw_material_purchases`, `payment_methods` | select |
| `inventory/production-batches.tsx` | `production_batches`, `finished_products`, `raw_materials` | select; RPC `create_production_batch` |
| `inventory/production-batches/page.tsx` | `production_batches`, `finished_products`, `raw_materials` | select |
| `inventory/internal-consumption.tsx` | `internal_consumption`, `finished_products` | select, insert |
| `inventory/internal-consumption/page.tsx` | `user_accounts`, `employees`, `internal_consumption`, `finished_products`, `projects`, `sites` | select |
| `reports/inventory-report-data.ts` | `raw_materials`, `finished_products`, `production_batches`, `income_register`, `clients`, `internal_consumption`, `sites` | select |

---

## Dashboard — Self-service, client portal, admin UI

| File | Tables | Operations |
|------|--------|------------|
| `self-service/leave/page.tsx` | `employee_leave_balances`, `leave_requests`, `leave_types` | select |
| `self-service/my-leave.tsx` | `employee_leave_balances`, `leave_requests` | select |
| `self-service/attendance/page.tsx` | `employees`, `attendance_register` | select |
| `self-service/payslip/page.tsx` | `payroll_history` | select |
| `self-service/roster/page.tsx` | `employees`, `roster_history`, `projects`, `sites`, `roster_config` | select |
| `client-portal/invoices/page.tsx` | `income_register` | select |
| `client-dashboard-utils.ts` | `clients`, `income_register`, `sites`, `inspection_summary` | select |
| `employee-dashboard-utils.ts` | `employees`, `attendance_register`, `employee_leave_balances`, `leave_requests`, `payroll_history` | select |
| `leave-approvals/page.tsx` | `leave_requests` | select |
| `leave-approvals/leave-approvals.tsx` | `leave_requests` | select |
| `my-account/page.tsx` | `user_accounts`, `employees` | select |
| `user-accounts/page.tsx` | `user_accounts`, `employees`, `clients`, `sites` | select (**SR**) |
| `page.tsx` (main dashboard) | `income_register`, `expense_register`, `fixed_assets`, `accounts_payable`, `capital_contributions`, `manual_financial_entries`, `payroll_history`, `month_end_close`, `payroll_processing` + balance sheet inventory | select; supervisor path uses **SR** via `operations-dashboard-utils` |

---

## Postgres RPCs needing tenant guards (SQL follow-up, not app)

These functions mutate data without going through PostgREST table APIs:

| RPC | Defined in | Tables touched |
|-----|------------|----------------|
| `submit_leave_request` | script 49 | `leave_requests`, `employee_leave_balances` |
| `approve_leave_request` | script 49 | `leave_requests`, `employee_leave_balances` |
| `reject_leave_request` | script 49 | `leave_requests` |
| `cancel_leave_request` | script 49 | `leave_requests`, `employee_leave_balances` |
| `change_leave_approver` | script 49 | `leave_approver_config` |
| `create_product_sale` | script 40 | `income_register`, `finished_products`, `stock_movements` |
| `void_product_sale` | script 43 | `income_register`, `finished_products` |
| `create_production_batch` | script 38 | `production_batches`, `production_batch_materials`, `raw_materials` |
| `delete_*_cascade` (multiple) | scripts 46–57 | various inventory/finance tables |
| `recalculate_raw_material_inventory` | script 44 | `raw_materials` |
| `get_duty_roster_employee_display` | script 56/60 | `employees` (tenant filter added in script 60) |

---

## Tables in schema inventory NOT queried by app (RLS still applies if exposed)

These receive `tenant_id` in script 59 and tenant RLS in script 60 but have no direct app queries today:

`action_status_options`, `asset_register`, `complaint_priority_options`, `consumables`, `contract_status_options`, `disciplinary_records`, `employee_employment_history`, `equipment_register`, `equipment_status_options`, `exit_management`, `incident_type_options`, `inspection_result_options`, `leave_management` (legacy UI only), `month_end_close_backup_*`, `pay_rate_structure`, `paye_bands`, `paye_config`, `payroll_history_backup_*`, `payroll_link`, `production_batch_materials`, `recruitment_tracker`, `risk_level_options`, `roles`, `ssnit_config`, `ssnit_rates`, `stock_movements`, `todos`

---

## Recommended application follow-up (Phase 2)

1. Add `tenantId` to `getCurrentUserAccount()` in `utils/dashboard-auth.ts`.
2. Spread `tenant_id` into all insert/upsert payloads (or rely on trigger for authenticated sessions).
3. Service-role routes: resolve tenant from admin user's `user_accounts.tenant_id` and include on every write.
4. Patch leave/inventory/finance RPCs to validate `tenant_id` via `current_user_tenant_id()`.
5. Consider composite unique constraints scoped by `tenant_id` before onboarding Tenant 2 (see Phase 1 summary).
