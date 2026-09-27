import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import FinanceNav from "../finance-nav";
import ManualFinancialEntries from "../manual-financial-entries";
import type { ManualFinancialEntryRecord } from "../manual-financial-entries-utils";
import type { AccountsPayablePaymentRow } from "../directors-loan-utils";
import {
  DIRECTORS_LOAN_LEDGER_SELECT,
  type DirectorsLoanLedgerEntry,
} from "../directors-loan-ledger-utils";

export default async function ManualFinancialEntriesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [
    { data, error },
    { data: apPayments, error: apPaymentsError },
    { data: ledgerEntries, error: ledgerError },
    { data: expenseRows, error: expenseError },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("manual_financial_entries")
        .select("*")
        .eq("tenant_id", tenantId),
      buScope,
    ).order("period_month", { ascending: false }),
    applyBusinessUnitScope(
      supabase
        .from("accounts_payable_payments")
        .select("tenant_id, payment_date, amount, payment_source, business_unit_id")
        .eq("tenant_id", tenantId),
      buScope,
    ).order("payment_date", { ascending: true }),
    applyBusinessUnitScope(
      supabase
        .from("directors_loan_entries")
        .select(DIRECTORS_LOAN_LEDGER_SELECT)
        .eq("tenant_id", tenantId),
      buScope,
    ).order("entry_date", { ascending: false }),
    applyBusinessUnitScope(
      supabase
        .from("expense_register")
        .select("id, date, amount, description, expense_category")
        .eq("tenant_id", tenantId),
      buScope,
    )
      .order("date", { ascending: false })
      .limit(200),
  ]);

  const manualCashEntries = (data ?? []).map((entry) => ({
    period_month: entry.period_month,
    loan_proceeds: entry.loan_proceeds,
    loan_repayments: entry.loan_repayments,
    other_cash_inflows: entry.other_cash_inflows,
    opening_cash_balance: entry.opening_cash_balance,
    bank_loans: entry.bank_loans,
    other_long_term_liabilities: entry.other_long_term_liabilities,
    directors_loan: entry.directors_loan,
  }));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Manual Financial Entries
      </h2>
      <ManualFinancialEntries
        tenantId={tenantId}
        initialEntries={(data as ManualFinancialEntryRecord[] | null) ?? []}
        initialManualCashEntries={manualCashEntries}
        initialApPayments={(apPayments as AccountsPayablePaymentRow[] | null) ?? []}
        initialDirectorsLoanLedgerEntries={
          (ledgerEntries as DirectorsLoanLedgerEntry[] | null) ?? []
        }
        initialExpenseLinkOptions={
          (expenseRows as Array<{
            id: string;
            date: string;
            amount: number;
            description: string | null;
            expense_category: string | null;
          }> | null) ?? []
        }
        fetchError={
          error?.message ??
          apPaymentsError?.message ??
          ledgerError?.message ??
          expenseError?.message ??
          null
        }
        activeBusinessUnitId={activeBusinessUnitId}
      />
    </div>
  );
}
