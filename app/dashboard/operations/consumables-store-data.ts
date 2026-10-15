import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  CONSUMABLE_ITEM_SELECT,
  CONSUMABLE_MOVEMENT_SELECT,
  type ConsumableItemRecord,
  type ConsumableMovementRecord,
} from "./consumables-store-utils";
import {
  applySiteCodeScope,
  fetchScopedSiteCodes,
} from "./site-bu-scope-utils";
import { SITE_ASSIGNMENT_SELECT } from "./sites-utils";
import { SUPPLIER_SELECT, type SupplierRow } from "@/utils/suppliers-types";
import type { VendorSupplierOption } from "../finance/vendor-select-utils";
import { queryExpenseSubcategoryLookups } from "../finance/expense-register-utils";
import type { ExpenseSubcategoryLookup } from "../finance/expense-register-utils";
import { parseAccountsPayableIdFromAccrualReceiptNo } from "../finance/accounts-payable-accrual-utils";
import { formatConsumableMovementPurchaseLabel } from "./consumables-purchase-link-utils";

export type ConsumableSiteOption = {
  site_code: string;
  site_name: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
};

export async function fetchConsumableItemsForScope(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<{ items: ConsumableItemRecord[]; error: string | null }> {
  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("consumable_items")
      .select(CONSUMABLE_ITEM_SELECT)
      .eq("tenant_id", tenantId)
      .order("item_code", { ascending: true }),
    buScope,
  );

  if (error) {
    return { items: [], error: error.message };
  }
  return { items: (data as ConsumableItemRecord[] | null) ?? [], error: null };
}

export async function fetchConsumableMovementsForScope(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<{ movements: ConsumableMovementRecord[]; error: string | null }> {
  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("consumable_movements")
      .select(CONSUMABLE_MOVEMENT_SELECT)
      .eq("tenant_id", tenantId)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false }),
    buScope,
  );

  if (error) {
    return { movements: [], error: error.message };
  }
  return {
    movements: (data as ConsumableMovementRecord[] | null) ?? [],
    error: null,
  };
}

export async function fetchConsumableSitesForScope(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<{ sites: ConsumableSiteOption[]; error: string | null }> {
  const scoped = await fetchScopedSiteCodes(supabase, tenantId, buScope);
  if (scoped.error) {
    return { sites: [], error: scoped.error };
  }

  let query = supabase
    .from("sites")
    .select(SITE_ASSIGNMENT_SELECT)
    .eq("tenant_id", tenantId)
    .order("site_name", { ascending: true });

  query = applySiteCodeScope(query, scoped.siteCodes);

  const { data, error } = await query;
  if (error) {
    return { sites: [], error: error.message };
  }

  const sites = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const project = row.project as {
      project_code?: string | null;
      project_name?: string | null;
    } | null;
    return {
      site_code: String(row.site_code),
      site_name: String(row.site_name ?? row.site_code),
      project_id: (row.project_id as string | null) ?? null,
      project_code: project?.project_code ?? null,
      project_name: project?.project_name ?? null,
    };
  });

  return { sites, error: null };
}

export type ExpenseLinkOption = {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  receipt_no: string | null;
  vendor: string | null;
  vendor_label: string;
};

export type PayableLinkOption = {
  id: string;
  invoice_date: string;
  amount: number;
  vendor_name: string | null;
  invoice_number: string | null;
};

export async function fetchConsumablePurchaseLinkOptions(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
  sinceDate: string,
): Promise<{
  expenses: ExpenseLinkOption[];
  payables: PayableLinkOption[];
  error: string | null;
}> {
  const [expenseResult, payableResult] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("expense_register")
        .select("id, date, amount, description, receipt_no, vendor, expense_category")
        .eq("tenant_id", tenantId)
        .gte("date", sinceDate)
        .order("date", { ascending: false })
        .limit(500),
      buScope,
    ),
    applyBusinessUnitScope(
      supabase
        .from("accounts_payable")
        .select("id, invoice_date, amount, vendor_name, invoice_number")
        .eq("tenant_id", tenantId)
        .gte("invoice_date", sinceDate)
        .order("invoice_date", { ascending: false })
        .limit(500),
      buScope,
    ),
  ]);

  const error =
    expenseResult.error?.message ?? payableResult.error?.message ?? null;

  const expenses: ExpenseLinkOption[] = (
    (expenseResult.data as Array<{
      id: string;
      date: string;
      amount: number;
      description: string | null;
      receipt_no: string | null;
      vendor: string | null;
      expense_category: string | null;
    }> | null) ?? []
  ).map((row) => ({
    id: row.id,
    date: row.date,
    amount: Number(row.amount) || 0,
    description: row.description,
    receipt_no: row.receipt_no,
    vendor: row.vendor,
    vendor_label: [row.receipt_no, row.description, row.expense_category]
      .filter(Boolean)
      .join(" — "),
  }));

  const payables: PayableLinkOption[] = (
    (payableResult.data as PayableLinkOption[] | null) ?? []
  ).map((row) => ({
    ...row,
    amount: Number(row.amount) || 0,
  }));

  return { expenses, payables, error };
}

export async function fetchConsumableExpenseSubcategories(
  supabase: SupabaseClient,
): Promise<{ subcategories: ExpenseSubcategoryLookup[]; error: string | null }> {
  const { data, error } = await queryExpenseSubcategoryLookups(supabase);
  if (error) {
    return { subcategories: [], error: error.message };
  }
  return {
    subcategories: (data as ExpenseSubcategoryLookup[] | null) ?? [],
    error: null,
  };
}

export async function fetchConsumableSuppliers(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ suppliers: VendorSupplierOption[]; error: string | null }> {
  const { data, error } = await supabase
    .from("suppliers")
    .select(SUPPLIER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) {
    return { suppliers: [], error: error.message };
  }
  const suppliers = ((data as SupplierRow[] | null) ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }));
  return { suppliers, error: null };
}

export type ConsumableMovementPurchaseLink = {
  label: string;
  href: string;
};

export type ConsumableMovementDisplayMaps = {
  recordedByByAuthUid: Record<string, string>;
  expenseById: Record<string, ConsumableMovementPurchaseLink>;
  payableById: Record<string, ConsumableMovementPurchaseLink>;
  /** expense_register id → accounts_payable id for AP-ACCRUAL rows */
  accrualExpensePayableIdByExpenseId: Record<string, string>;
  supplierNameById: Record<string, string>;
};

const EMPTY_MOVEMENT_DISPLAY_MAPS: ConsumableMovementDisplayMaps = {
  recordedByByAuthUid: {},
  expenseById: {},
  payableById: {},
  accrualExpensePayableIdByExpenseId: {},
  supplierNameById: {},
};

function employeeFullNameFromJoin(
  employees:
    | { full_name?: string | null }
    | { full_name?: string | null }[]
    | null
    | undefined,
): string | null {
  if (!employees) {
    return null;
  }
  if (Array.isArray(employees)) {
    return employees[0]?.full_name?.trim() ?? null;
  }
  return employees.full_name?.trim() ?? null;
}

export async function fetchConsumableMovementDisplayMaps(
  supabase: SupabaseClient,
  tenantId: string,
  movements: Array<
    Pick<
      ConsumableMovementRecord,
      "created_by" | "expense_id" | "accounts_payable_id" | "supplier_id"
    >
  >,
): Promise<{ maps: ConsumableMovementDisplayMaps; error: string | null }> {
  const authUids = [
    ...new Set(
      movements
        .map((row) => row.created_by?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const expenseIds = [
    ...new Set(
      movements
        .map((row) => row.expense_id?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const payableIds = [
    ...new Set(
      movements
        .map((row) => row.accounts_payable_id?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const supplierIds = [
    ...new Set(
      movements
        .map((row) => row.supplier_id?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  if (
    authUids.length === 0 &&
    expenseIds.length === 0 &&
    payableIds.length === 0 &&
    supplierIds.length === 0
  ) {
    return { maps: EMPTY_MOVEMENT_DISPLAY_MAPS, error: null };
  }

  const [usersResult, expensesResult, payablesResult, suppliersResult] =
    await Promise.all([
    authUids.length
      ? supabase
          .from("user_accounts")
          .select(
            "auth_uid, email, employees!user_accounts_employee_id_fkey(full_name)",
          )
          .eq("tenant_id", tenantId)
          .in("auth_uid", authUids)
      : Promise.resolve({ data: [], error: null }),
    expenseIds.length
      ? supabase
          .from("expense_register")
          .select("id, receipt_no, vendor")
          .eq("tenant_id", tenantId)
          .in("id", expenseIds)
      : Promise.resolve({ data: [], error: null }),
    payableIds.length
      ? supabase
          .from("accounts_payable")
          .select("id, invoice_number, vendor_name")
          .eq("tenant_id", tenantId)
          .in("id", payableIds)
      : Promise.resolve({ data: [], error: null }),
    supplierIds.length
      ? supabase
          .from("suppliers")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("id", supplierIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const error =
    usersResult.error?.message ??
    expensesResult.error?.message ??
    payablesResult.error?.message ??
    suppliersResult.error?.message ??
    null;

  const recordedByByAuthUid: Record<string, string> = {};
  for (const row of (usersResult.data ?? []) as Array<{
    auth_uid: string;
    email: string | null;
    employees:
      | { full_name?: string | null }
      | { full_name?: string | null }[]
      | null;
  }>) {
    const name = employeeFullNameFromJoin(row.employees);
    recordedByByAuthUid[row.auth_uid] =
      name ?? row.email?.trim() ?? "Unknown user";
  }

  const accrualExpensePayableIdByExpenseId: Record<string, string> = {};
  const extraPayableIds = new Set<string>();
  for (const row of (expensesResult.data ?? []) as Array<{
    id: string;
    receipt_no: string | null;
  }>) {
    const apId = parseAccountsPayableIdFromAccrualReceiptNo(row.receipt_no);
    if (apId) {
      accrualExpensePayableIdByExpenseId[row.id] = apId;
      if (!payableIds.includes(apId)) {
        extraPayableIds.add(apId);
      }
    }
  }

  let extraPayablesResult: { data: unknown[] | null; error: { message: string } | null } =
    { data: [], error: null };
  if (extraPayableIds.size > 0) {
    extraPayablesResult = await supabase
      .from("accounts_payable")
      .select("id, invoice_number, vendor_name")
      .eq("tenant_id", tenantId)
      .in("id", [...extraPayableIds]);
  }

  const expenseById: Record<string, ConsumableMovementPurchaseLink> = {};
  for (const row of (expensesResult.data ?? []) as Array<{
    id: string;
    receipt_no: string | null;
    vendor: string | null;
  }>) {
    if (accrualExpensePayableIdByExpenseId[row.id]) {
      continue;
    }
    expenseById[row.id] = {
      label: formatConsumableMovementPurchaseLabel({
        kind: "expense",
        receiptNo: row.receipt_no,
        vendor: row.vendor,
      }),
      href: `/dashboard/finance/expenses?expenseId=${encodeURIComponent(row.id)}`,
    };
  }

  const payableById: Record<string, ConsumableMovementPurchaseLink> = {};
  const allPayableRows = [
    ...((payablesResult.data ?? []) as Array<{
      id: string;
      invoice_number: string | null;
      vendor_name: string | null;
    }>),
    ...((extraPayablesResult.data ?? []) as Array<{
      id: string;
      invoice_number: string | null;
      vendor_name: string | null;
    }>),
  ];
  for (const row of allPayableRows) {
    payableById[row.id] = {
      label: formatConsumableMovementPurchaseLabel({
        kind: "payable",
        invoiceNumber: row.invoice_number,
        vendorName: row.vendor_name,
      }),
      href: `/dashboard/finance/accounts-payable?apId=${encodeURIComponent(row.id)}`,
    };
  }

  const supplierNameById: Record<string, string> = {};
  for (const row of (suppliersResult.data ?? []) as Array<{
    id: string;
    name: string;
  }>) {
    supplierNameById[row.id] = row.name?.trim() || row.id;
  }

  const mapsError =
    error ?? extraPayablesResult.error?.message ?? null;

  return {
    maps: {
      recordedByByAuthUid,
      expenseById,
      payableById,
      accrualExpensePayableIdByExpenseId,
      supplierNameById,
    },
    error: mapsError,
  };
}
