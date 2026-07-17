import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../finance/balance-sheet-page-data";
import { buildAvailableYears } from "../finance/finance-year-utils";
import type { CapitalContributionEntry } from "../finance/capital-contributions-utils";
import type { AccountsPayableEntry } from "../finance/accounts-payable-utils";
import type { FixedAssetScheduleAsset } from "./finance-reports-utils";
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
      .select("date, service_category, amount, entry_type, sale_status")
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select("date, expense_category, sub_category, amount")
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
) {
  return fetchBalanceSheetPageData(supabase);
}

export async function fetchCashFlowReportData(supabase: SupabaseClient) {
  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: manualEntries, error: manualError },
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select("date, amount_received")
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select("date, sub_category, amount, payment_status")
      .order("date", { ascending: true }),
    supabase.from("manual_financial_entries").select("*").order("period_month", {
      ascending: true,
    }),
  ]);

  return {
    initialIncomeEntries: incomeEntries ?? [],
    initialExpenseEntries: expenseEntries ?? [],
    initialManualEntries: manualEntries ?? [],
    availableYears: buildAvailableYears(
      (incomeEntries ?? []).map((entry) => entry.date),
      (expenseEntries ?? []).map((entry) => entry.date),
      (manualEntries ?? []).map((entry) => entry.period_month),
    ),
    fetchError:
      incomeError?.message ??
      expenseError?.message ??
      manualError?.message ??
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
  const [
    { data: payables, error: payableError },
    { data: manualEntries, error: manualError },
  ] = await Promise.all([
    supabase
      .from("accounts_payable")
      .select("*")
      .order("due_date", { ascending: true }),
    supabase.from("manual_financial_entries").select("*").order("period_month", {
      ascending: true,
    }),
  ]);

  return {
    initialPayables: (payables as AccountsPayableEntry[] | null) ?? [],
    initialManualEntries: manualEntries ?? [],
    fetchError: payableError?.message ?? manualError?.message ?? null,
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
    .select("id, date, contributed_by, amount, description, notes, employees(full_name)")
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
