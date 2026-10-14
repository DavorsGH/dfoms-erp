import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT,
  PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
} from "../hr-payroll/payroll-lock-finance-utils";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  assertCanModifyBusinessUnitRow,
  type AllowedBusinessUnits,
} from "@/utils/business-unit-access";
import { parseAccountsPayableIdFromAccrualReceiptNo } from "./accounts-payable-accrual-utils";
import type { ExpenseRegisterEntry } from "./expense-register-utils";
import { normalizeExpenseRegisterProjectIdForDatabase } from "./expense-register-utils";
import { normalizeCategoryName } from "./profit-loss-utils";
import {
  columnValuePassesFilter,
  dateValuePassesRangeFilter,
  type RegisterColumnFilterValue,
  type RegisterDateRangeFilterValue,
} from "./register-column-filter";
import { toDateInputValue } from "./register-row-actions";

/** Set true after accounts_payable.project_id exists and AP sync is wired. */
export const EXPENSE_BULK_SYNC_LINKED_AP_PROJECT = false;

export const EXPENSE_BULK_ASSIGN_BATCH_SIZE = 50;

export type ExpenseRegisterListFilterContext = {
  dateFilter: RegisterDateRangeFilterValue;
  categoryFilter: RegisterColumnFilterValue;
  subCategoryFilter: RegisterColumnFilterValue;
  descriptionFilter: RegisterColumnFilterValue;
  paymentStatusFilter: RegisterColumnFilterValue;
  projectSiteFilter: RegisterColumnFilterValue;
  paymentStatusLabel: (entry: ExpenseRegisterEntry) => string;
  contractSiteLabel: (entry: ExpenseRegisterEntry) => string;
};

export function expenseRegisterEntryMatchesListFilters(
  entry: ExpenseRegisterEntry,
  filters: ExpenseRegisterListFilterContext,
): boolean {
  return (
    dateValuePassesRangeFilter(toDateInputValue(entry.date), filters.dateFilter) &&
    columnValuePassesFilter(entry.expense_category, filters.categoryFilter) &&
    columnValuePassesFilter(entry.sub_category, filters.subCategoryFilter) &&
    columnValuePassesFilter(entry.description, filters.descriptionFilter) &&
    columnValuePassesFilter(
      filters.paymentStatusLabel(entry),
      filters.paymentStatusFilter,
    ) &&
    columnValuePassesFilter(
      filters.contractSiteLabel(entry),
      filters.projectSiteFilter,
    )
  );
}

export function isExpenseRegisterPayrollLabourCategory(
  expenseCategory: string | null | undefined,
): boolean {
  const normalized = normalizeCategoryName(expenseCategory ?? "");
  return (
    normalized === normalizeCategoryName(PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES) ||
    normalized === normalizeCategoryName(PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT)
  );
}

export type ExpenseBulkProjectSelectionBlockReason =
  | "payroll_labour"
  | "pending_sync";

export function explainExpenseBulkProjectSelectionBlock(
  entry: ExpenseRegisterEntry & { pendingSync?: boolean },
): ExpenseBulkProjectSelectionBlockReason | null {
  if (entry.pendingSync) {
    return "pending_sync";
  }
  if (isExpenseRegisterPayrollLabourCategory(entry.expense_category)) {
    return "payroll_labour";
  }
  return null;
}

export function expenseBulkProjectSelectionBlockTooltip(
  reason: ExpenseBulkProjectSelectionBlockReason,
): string {
  if (reason === "pending_sync") {
    return "This row is pending offline sync and cannot be bulk-assigned yet.";
  }
  return "Staff Salaries and Employer SSNIT are payroll labour — assign via payroll/project_contract, not here (avoids double counting in Contract Profitability).";
}

export type BulkAssignExpenseProjectResult = {
  succeededIds: string[];
  failed: Array<{ id: string; reason: string }>;
};

export async function bulkAssignExpenseRegisterProjectIds(input: {
  supabase: SupabaseClient;
  tenantId: string;
  buReadScope: BusinessUnitReadScope;
  allowedUnits: AllowedBusinessUnits;
  entriesById: Map<string, ExpenseRegisterEntry & { business_unit_id?: string | null }>;
  expenseIds: string[];
  projectId: string | null;
}): Promise<BulkAssignExpenseProjectResult> {
  const {
    supabase,
    tenantId,
    buReadScope,
    allowedUnits,
    entriesById,
    expenseIds,
    projectId,
  } = input;

  const succeededIds: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (let offset = 0; offset < expenseIds.length; offset += EXPENSE_BULK_ASSIGN_BATCH_SIZE) {
    const batch = expenseIds.slice(offset, offset + EXPENSE_BULK_ASSIGN_BATCH_SIZE);

    for (const expenseId of batch) {
      const entry = entriesById.get(expenseId);
      if (!entry) {
        failed.push({ id: expenseId, reason: "Expense not found in the current list." });
        continue;
      }

      const block = explainExpenseBulkProjectSelectionBlock(entry);
      if (block) {
        failed.push({
          id: expenseId,
          reason: expenseBulkProjectSelectionBlockTooltip(block),
        });
        continue;
      }

      try {
        assertCanModifyBusinessUnitRow(
          allowedUnits,
          entry.business_unit_id ?? null,
        );
      } catch (accessError) {
        failed.push({
          id: expenseId,
          reason:
            accessError instanceof Error
              ? accessError.message
              : "Business unit access denied.",
        });
        continue;
      }

      const { data: updatedRow, error: updateError } = await applyBusinessUnitScope(
        supabase
          .from("expense_register")
          .update({ project_id: projectId })
          .eq("id", expenseId)
          .eq("tenant_id", tenantId),
        buReadScope,
      )
        .select("id")
        .maybeSingle();

      if (updateError) {
        failed.push({ id: expenseId, reason: updateError.message });
        continue;
      }

      if (!updatedRow) {
        failed.push({
          id: expenseId,
          reason: "No row updated (access scope or record missing).",
        });
        continue;
      }

      if (EXPENSE_BULK_SYNC_LINKED_AP_PROJECT) {
        const apId = parseAccountsPayableIdFromAccrualReceiptNo(entry.receipt_no);
        if (apId) {
          const { error: apError } = await applyBusinessUnitScope(
            supabase
              .from("accounts_payable")
              .update({ project_id: projectId })
              .eq("id", apId)
              .eq("tenant_id", tenantId),
            buReadScope,
          );
          if (apError) {
            failed.push({
              id: expenseId,
              reason: `Expense updated but linked AP bill failed: ${apError.message}`,
            });
            continue;
          }
        }
      }

      succeededIds.push(expenseId);
    }
  }

  return { succeededIds, failed };
}

export function normalizeBulkAssignProjectFormValue(
  formValue: string,
): string | null {
  return normalizeExpenseRegisterProjectIdForDatabase(formValue);
}
