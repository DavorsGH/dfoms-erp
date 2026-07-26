import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  fetchBalanceSheetPageData,
  fetchCashFlowInventoryPurchaseInput,
} from "../finance/balance-sheet-page-data";
import { buildAvailableYears } from "../finance/finance-year-utils";
import type { CapitalContributionEntry } from "../finance/capital-contributions-utils";
import {
  TAX_LEDGER_SELECT,
  normalizeTaxLedgerEntry,
  type TaxLedgerEntry,
} from "../finance/tax-ledger-utils";
import type {
  FixedAssetScheduleAsset,
  StatutoryLiabilityDueDates,
} from "./finance-reports-utils";
import {
  RECEIVABLES_INCOME_SELECT,
  normalizeIncomeRegisterEntry,
  type IncomeRegisterEntry,
} from "../finance/income-register-utils";

export async function fetchMonthlyPlReportData(supabase: SupabaseClient) {
  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: fixedAssets, error: fixedAssetsError },
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select(
        "date, service_category, amount, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, net_of_tax_amount, input_vat_amount",
      )
      .order("date", { ascending: true }),
    supabase
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .order("asset_id", { ascending: true }),
  ]);

  return {
    initialIncomeEntries: incomeEntries ?? [],
    initialExpenseEntries: expenseEntries ?? [],
    initialFixedAssets: fixedAssets ?? [],
    availableYears: buildAvailableYears(
      (incomeEntries ?? []).map((entry) => entry.date),
      (expenseEntries ?? []).map((entry) => entry.date),
    ),
    fetchError:
      incomeError?.message ??
      expenseError?.message ??
      fixedAssetsError?.message ??
      null,
  };
}

export async function fetchMonthlyBalanceSheetReportData(
  supabase: SupabaseClient,
  tenantId: string,
) {
  return fetchBalanceSheetPageData(supabase, tenantId);
}

export async function fetchCashFlowReportData(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: manualEntries, error: manualError },
    { data: fixedAssets, error: fixedAssetsError },
    { data: capitalContributions, error: capitalError },
    inventoryPurchases,
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select("date, amount_received, entry_type, sale_status")
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select(
        "date, sub_category, amount, payment_status, expense_category, description, receipt_no",
      )
      .order("date", { ascending: true }),
    supabase.from("manual_financial_entries").select("*").order("period_month", {
      ascending: true,
    }),
    supabase
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .order("asset_id", { ascending: true }),
    supabase
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .order("date", { ascending: true }),
    fetchCashFlowInventoryPurchaseInput(supabase, tenantId),
  ]);

  return {
    initialIncomeEntries: incomeEntries ?? [],
    initialExpenseEntries: expenseEntries ?? [],
    initialManualEntries: manualEntries ?? [],
    initialInventoryPurchases: inventoryPurchases,
    initialFixedAssets: fixedAssets ?? [],
    initialCapitalContributions: capitalContributions ?? [],
    availableYears: buildAvailableYears(
      (incomeEntries ?? []).map((entry) => entry.date),
      (expenseEntries ?? []).map((entry) => entry.date),
      [
        ...(manualEntries ?? []).map((entry) => entry.period_month),
        ...(fixedAssets ?? []).map((entry) => entry.purchase_date),
        ...(capitalContributions ?? []).map((entry) => entry.date),
      ],
    ),
    fetchError:
      incomeError?.message ??
      expenseError?.message ??
      manualError?.message ??
      fixedAssetsError?.message ??
      capitalError?.message ??
      null,
  };
}

export async function fetchArAgingReportData(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("income_register")
    .select(RECEIVABLES_INCOME_SELECT)
    .order("due_date", { ascending: true });

  return {
    initialIncomeEntries:
      (data as IncomeRegisterEntry[] | null)?.map((entry) =>
        normalizeIncomeRegisterEntry(entry),
      ) ?? [],
    fetchError: error?.message ?? null,
  };
}

export async function fetchStatutoryLiabilitiesReportData(
  supabase: SupabaseClient,
) {
  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return {
      initialTaxLedgerEntries: [],
      initialDueDates: null,
      fetchError: "Unable to resolve tenant for Statutory Liabilities Report.",
    };
  }

  const [
    { data: entries, error: entriesError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    supabase
      .from("tax_ledger_entries")
      .select(TAX_LEDGER_SELECT)
      .eq("tenant_id", tenantId)
      .order("entry_date", { ascending: false }),
    supabase
      .from("tax_settings")
      .select(
        "next_ssnit_due_date, next_tier2_due_date, next_paye_due_date, next_vat_due_date, next_wht_due_date",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  return {
    initialTaxLedgerEntries: ((entries as TaxLedgerEntry[] | null) ?? []).map(
      normalizeTaxLedgerEntry,
    ),
    initialDueDates: (settings as StatutoryLiabilityDueDates | null) ?? null,
    fetchError: entriesError?.message ?? settingsError?.message ?? null,
  };
}

export async function fetchFixedAssetScheduleReportData(
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase
    .from("fixed_assets")
    .select(
      "asset_id, asset_name, asset_category, purchase_date, original_cost, quantity, useful_life_years, depreciation_method",
    )
    .order("asset_id", { ascending: true });

  return {
    initialFixedAssets: (data as FixedAssetScheduleAsset[] | null) ?? [],
    availableYears: buildAvailableYears(
      (data ?? []).map((entry) => entry.purchase_date),
      [],
    ),
    fetchError: error?.message ?? null,
  };
}

export async function fetchCapitalContributionsReportData(
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase
    .from("capital_contributions")
    .select("id, date, contributed_by, amount, description, notes, employees!capital_contributions_contributed_by_fkey(full_name)")
    .order("date", { ascending: true });

  return {
    initialContributions: (data as CapitalContributionEntry[] | null) ?? [],
    fetchError: error?.message ?? null,
  };
}

export async function fetchExpenseReportData(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("expense_register")
    .select(
      "id, date, description, expense_category, sub_category, payment_status, amount",
    )
    .order("date", { ascending: true });

  return {
    initialExpenseEntries: data ?? [],
    availableYears: buildAvailableYears(
      (data ?? []).map((entry) => entry.date),
      [],
    ),
    fetchError: error?.message ?? null,
  };
}
