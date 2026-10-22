import type { SupabaseClient } from "@supabase/supabase-js";
import {
  annotateFinanceApprovers,
  routeFinanceApprovals,
  type ActiveStaffAccount,
  type AnnotatedFinanceApprover,
} from "@/lib/active-staff-options";
import {
  activeApproversForForms,
  mapApproverRows,
  toDisplayApprovers,
} from "@/app/dashboard/approver-utils";
import type { Approver } from "@/app/dashboard/lookup-types";

/** Join shape used when loading the Finance Approvers config and form lookups. */
export const FINANCE_APPROVER_SELECT =
  "employee_id, employees!approvers_employee_id_fkey(full_name, staff_id, employment_status)" as const;

export const FINANCE_APPROVER_ACCOUNT_SELECT =
  "auth_uid, employee_id, is_active, role" as const;

export function buildFinanceApproverFormLookups(
  approverRows: unknown[] | null | undefined,
  accounts: ActiveStaffAccount[] | null | undefined,
): {
  allApprovers: Approver[];
  activeApprovers: Approver[];
  annotated: AnnotatedFinanceApprover[];
  notifyAdminsDirectors: boolean;
} {
  const mapped = mapApproverRows(
    (approverRows as Parameters<typeof mapApproverRows>[0]) ?? [],
  );
  const annotated = annotateFinanceApprovers(mapped, accounts ?? []);
  const routed = routeFinanceApprovals(annotated);
  return {
    allApprovers: toDisplayApprovers(annotated),
    activeApprovers: activeApproversForForms(annotated),
    annotated,
    notifyAdminsDirectors: routed.notifyAdminsDirectors,
  };
}

/**
 * Load saved finance approvers for create/edit dropdowns.
 * Skips inactive / no-login; when none remain, `notifyAdminsDirectors` is true.
 */
export async function loadActiveFinanceApproversForForms(
  client: SupabaseClient,
  tenantId: string | null | undefined,
): Promise<{
  activeApprovers: Approver[];
  notifyAdminsDirectors: boolean;
  error: string | null;
}> {
  if (!tenantId) {
    return {
      activeApprovers: [],
      notifyAdminsDirectors: true,
      error: null,
    };
  }

  const [
    { data: approverRows, error: approversError },
    { data: accounts, error: accountsError },
  ] = await Promise.all([
    client
      .from("approvers")
      .select(FINANCE_APPROVER_SELECT)
      .eq("tenant_id", tenantId)
      .order("employee_id", { ascending: true }),
    client
      .from("user_accounts")
      .select(FINANCE_APPROVER_ACCOUNT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("is_active", true),
  ]);

  const error = approversError?.message ?? accountsError?.message ?? null;
  if (error) {
    return { activeApprovers: [], notifyAdminsDirectors: true, error };
  }

  const built = buildFinanceApproverFormLookups(
    approverRows ?? [],
    (accounts as ActiveStaffAccount[] | null) ?? [],
  );
  return {
    activeApprovers: built.activeApprovers,
    notifyAdminsDirectors: built.notifyAdminsDirectors,
    error: null,
  };
}
