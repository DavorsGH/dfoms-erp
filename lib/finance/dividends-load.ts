import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DIVIDEND_DECLARATION_SELECT,
  DIVIDEND_LINE_SELECT,
  TENANT_SHAREHOLDER_SELECT,
  type DividendBalanceSheetDeclaration,
  type DividendBalanceSheetLine,
  type DividendDeclarationLineRow,
  type DividendDeclarationRow,
  type TenantShareholderRow,
} from "@/app/dashboard/finance/dividends-types";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";

const DIVIDEND_TABLE_NAMES = [
  "dividend_declarations",
  "dividend_declaration_lines",
  "tenant_shareholders",
] as const;

export function isMissingDividendSchemaError(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }
  const lower = message.toLowerCase();
  if (!lower.includes("schema cache") && !lower.includes("does not exist")) {
    return false;
  }
  return DIVIDEND_TABLE_NAMES.some((table) => lower.includes(table));
}

function logMissingDividendSchema(tenantId: string, message: string) {
  console.warn(
    `[dividends-load] Dividend tables unavailable for tenant ${tenantId}; treating as zero dividends. ${message}`,
  );
}

export const DIVIDEND_BS_DECLARATION_SELECT =
  "id, business_unit_id, status, declaration_date, gross_amount, net_amount";

export async function fetchTenantShareholders(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ rows: TenantShareholderRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("tenant_shareholders")
    .select(TENANT_SHAREHOLDER_SELECT)
    .eq("tenant_id", tenantId)
    .order("full_name", { ascending: true });

  if (error) {
    return { rows: [], error: error.message };
  }
  return { rows: (data ?? []) as TenantShareholderRow[], error: null };
}

export const SHAREHOLDER_DELETE_BLOCKED_MESSAGE =
  "This shareholder is on a dividend declaration, so they can't be deleted. Deactivate them instead.";

export async function shareholderIdsOnDividendDeclarationLines(
  supabase: SupabaseClient,
  tenantId: string,
  shareholderIds: string[],
): Promise<{ referencedIds: Set<string>; error: string | null }> {
  if (shareholderIds.length === 0) {
    return { referencedIds: new Set(), error: null };
  }

  const { data, error } = await supabase
    .from("dividend_declaration_lines")
    .select("shareholder_id")
    .eq("tenant_id", tenantId)
    .in("shareholder_id", shareholderIds);

  if (error) {
    return { referencedIds: new Set(), error: error.message };
  }

  const referencedIds = new Set<string>();
  for (const row of data ?? []) {
    const shareholderId = row.shareholder_id;
    if (typeof shareholderId === "string" && shareholderId) {
      referencedIds.add(shareholderId);
    }
  }
  return { referencedIds, error: null };
}

export async function enrichShareholdersWithCanDelete(
  supabase: SupabaseClient,
  tenantId: string,
  rows: TenantShareholderRow[],
): Promise<{ rows: TenantShareholderRow[]; error: string | null }> {
  const { referencedIds, error } = await shareholderIdsOnDividendDeclarationLines(
    supabase,
    tenantId,
    rows.map((row) => row.id),
  );
  if (error) {
    return { rows, error };
  }
  return {
    rows: rows.map((row) => ({
      ...row,
      can_delete: !referencedIds.has(row.id),
    })),
    error: null,
  };
}

export async function fetchDividendDeclarations(
  supabase: SupabaseClient,
  tenantId: string,
  options?: { businessUnitId?: string | null },
): Promise<{ rows: DividendDeclarationRow[]; error: string | null }> {
  let query = supabase
    .from("dividend_declarations")
    .select(DIVIDEND_DECLARATION_SELECT)
    .eq("tenant_id", tenantId);

  const scopedBu = options?.businessUnitId?.trim();
  if (scopedBu) {
    query = query.eq("business_unit_id", scopedBu);
  }

  const { data, error } = await query
    .order("declaration_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return { rows: [], error: error.message };
  }
  return { rows: (data ?? []) as DividendDeclarationRow[], error: null };
}

export async function fetchDividendDeclarationWriteBundle(
  supabase: SupabaseClient,
  tenantId: string,
  declarationId: string,
): Promise<{
  declaration: DividendDeclarationRow | null;
  lines: DividendDeclarationLineRow[];
}> {
  const [declarationResult, linesResult] = await Promise.all([
    supabase
      .from("dividend_declarations")
      .select(DIVIDEND_DECLARATION_SELECT)
      .eq("tenant_id", tenantId)
      .eq("id", declarationId)
      .maybeSingle(),
    fetchDividendDeclarationLines(supabase, tenantId, [declarationId]),
  ]);

  return {
    declaration: (declarationResult.data ?? null) as DividendDeclarationRow | null,
    lines: linesResult.rows,
  };
}

export async function fetchDividendDeclarationLines(
  supabase: SupabaseClient,
  tenantId: string,
  declarationIds?: string[],
): Promise<{ rows: DividendDeclarationLineRow[]; error: string | null }> {
  let query = supabase
    .from("dividend_declaration_lines")
    .select(DIVIDEND_LINE_SELECT)
    .eq("tenant_id", tenantId);

  if (declarationIds !== undefined) {
    if (declarationIds.length === 0) {
      return { rows: [], error: null };
    }
    query = query.in("declaration_id", declarationIds);
  }

  const { data, error } = await query.order("payee_name", { ascending: true });

  if (error) {
    return { rows: [], error: error.message };
  }
  return { rows: (data ?? []) as DividendDeclarationLineRow[], error: null };
}

export async function fetchDividendBalanceSheetData(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{
  declarations: DividendBalanceSheetDeclaration[];
  lines: DividendBalanceSheetLine[];
  error: string | null;
}> {
  const [{ data: declarations, error: declError }, { data: lines, error: lineError }] =
    await Promise.all([
      supabase
        .from("dividend_declarations")
        .select(DIVIDEND_BS_DECLARATION_SELECT)
        .eq("tenant_id", tenantId),
      supabase
        .from("dividend_declaration_lines")
        .select("declaration_id, paid_amount, payment_date, net_amount")
        .eq("tenant_id", tenantId),
    ]);

  const loadError = declError?.message ?? lineError?.message ?? null;
  if (loadError) {
    if (isMissingDividendSchemaError(loadError)) {
      logMissingDividendSchema(tenantId, loadError);
      return { declarations: [], lines: [], error: null };
    }
    return {
      declarations: [],
      lines: [],
      error: loadError,
    };
  }

  return {
    declarations: (declarations ?? []) as DividendBalanceSheetDeclaration[],
    lines: (lines ?? []) as DividendBalanceSheetLine[],
    error: null,
  };
}

export function resolveBalanceSheetDividendBusinessUnitId(
  buScope: BusinessUnitReadScope,
): string | null {
  if (buScope.mode === "unit") {
    return buScope.id;
  }
  return null;
}
