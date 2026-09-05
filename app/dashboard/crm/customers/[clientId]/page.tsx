import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { isCrmCustomerListOnlyRole } from "@/app/dashboard/user-account-role-utils";
import {
  getEmployeeDisplayName,
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "../../../hr-payroll/employee-utils";
import {
  SALES_ACTIVITY_SELECT,
  normalizeSalesActivity,
  type SalesActivity,
} from "../../sales-pipeline/sales-pipeline-utils";
import CrmShell from "../../crm-shell";
import Customer360 from "../customer-360";
import {
  CUSTOMER_360_INVOICE_SELECT,
  CUSTOMER_360_LOYALTY_TRANSACTION_SELECT,
  CUSTOMER_360_OPPORTUNITY_SELECT,
  CUSTOMER_360_PRODUCT_SALE_SELECT,
  CUSTOMER_360_QUOTATION_SELECT,
  CUSTOMER_360_SERVICE_CONTRACT_SELECT,
  CUSTOMER_360_QUOTE_SELECT,
  normalizeCustomer360Invoice,
  normalizeCustomer360Opportunity,
  normalizeCustomer360ProductSale,
  normalizeCustomer360Quotation,
  normalizeCustomer360Quote,
  normalizeCustomer360ServiceContract,
  normalizeLoyaltyAccount,
  normalizeLoyaltyTransaction,
  type Customer360Invoice,
  type Customer360LoyaltyAccount,
  type Customer360LoyaltyTransaction,
  type Customer360Opportunity,
  type Customer360ProductSale,
  type Customer360Quotation,
  type Customer360Quote,
  type Customer360ServiceContract,
} from "../customer-360-utils";
import type { CustomerEntry } from "../customers-utils";

type CustomerDetailPageProps = {
  params: Promise<{ clientId: string }>;
};

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  const role = (await getCurrentUserRole()) as AppRole | null;
  const { clientId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [
    { data: customer, error: customerError },
    { data: employees, error: employeesError },
    { data: opportunities, error: opportunitiesError },
    { data: quotes, error: quotesError },
    { data: quotations, error: quotationsError },
    { data: serviceContracts, error: serviceContractsError },
    { data: invoices, error: invoicesError },
    { data: productSales, error: productSalesError },
    { data: activities, error: activitiesError },
    { data: loyaltyAccount, error: loyaltyAccountError },
    { data: loyaltyTransactions, error: loyaltyTransactionsError },
  ] = await Promise.all([
    supabase.from("customers").select("*").eq("client_id", clientId).maybeSingle(),
    applyBusinessUnitScope(
      supabase.from("employees").select(HR_EMPLOYEE_SELECT),
      buScope,
    ).order("full_name"),
    applyBusinessUnitScope(
      supabase
        .from("sales_opportunities")
        .select(CUSTOMER_360_OPPORTUNITY_SELECT)
        .eq("client_id", clientId),
      buScope,
    ).order("updated_at", { ascending: false }),
    supabase
      .from("sales_quotes")
      .select(CUSTOMER_360_QUOTE_SELECT)
      .eq("client_id", clientId)
      .order("quote_date", { ascending: false }),
    applyBusinessUnitScope(
      supabase
        .from("client_quotations")
        .select(CUSTOMER_360_QUOTATION_SELECT)
        .eq("client_id", clientId),
      buScope,
    ).order("issue_date", { ascending: false }),
    applyBusinessUnitScope(
      supabase
        .from("service_contracts")
        .select(CUSTOMER_360_SERVICE_CONTRACT_SELECT)
        .eq("client_id", clientId),
      buScope,
    ).order("start_date", { ascending: false }),
    applyBusinessUnitScope(
      supabase
        .from("client_invoices")
        .select(CUSTOMER_360_INVOICE_SELECT)
        .eq("client_id", clientId),
      buScope,
    ).order("invoice_date", { ascending: false }),
    applyBusinessUnitScope(
      supabase
        .from("income_register")
        .select(CUSTOMER_360_PRODUCT_SALE_SELECT)
        .eq("client_id", clientId)
        .eq("entry_type", "product_sale"),
      buScope,
    ).order("date", { ascending: false }),
    supabase
      .from("sales_activities")
      .select(SALES_ACTIVITY_SELECT)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    supabase
      .from("loyalty_accounts")
      .select("id, tenant_id, client_id, points_balance, lifetime_earned, lifetime_redeemed")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("loyalty_transactions")
      .select(CUSTOMER_360_LOYALTY_TRANSACTION_SELECT)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
  ]);

  if (!customer) {
    notFound();
  }

  const customerEntry = customer as CustomerEntry;
  const supervisorName = customerEntry.assigned_supervisor
    ? getEmployeeDisplayName(
        (employees as HrEmployee[] | null) ?? [],
        customerEntry.assigned_supervisor,
      )
    : "?";

  const fetchError =
    customerError?.message ??
    employeesError?.message ??
    opportunitiesError?.message ??
    quotesError?.message ??
    quotationsError?.message ??
    serviceContractsError?.message ??
    invoicesError?.message ??
    productSalesError?.message ??
    activitiesError?.message ??
    loyaltyAccountError?.message ??
    loyaltyTransactionsError?.message ??
    null;

  return (
    <CrmShell
      sectionTitle="Customer List"
      customerListOnly={isCrmCustomerListOnlyRole(role)}
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-[#0f2744]">Customer 360</h3>
        <Link
          href="/dashboard/crm/customers"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <Customer360
        customer={customerEntry}
        supervisorName={supervisorName}
        opportunities={
          ((opportunities as Customer360Opportunity[] | null) ?? []).map((row) =>
            normalizeCustomer360Opportunity(row),
          )
        }
        quotes={
          ((quotes as Customer360Quote[] | null) ?? []).map((row) =>
            normalizeCustomer360Quote(row),
          )
        }
        quotations={
          ((quotations as Customer360Quotation[] | null) ?? []).map((row) =>
            normalizeCustomer360Quotation(row),
          )
        }
        serviceContracts={
          ((serviceContracts as Customer360ServiceContract[] | null) ?? []).map(
            (row) => normalizeCustomer360ServiceContract(row),
          )
        }
        invoices={
          ((invoices as Customer360Invoice[] | null) ?? []).map((row) =>
            normalizeCustomer360Invoice(row),
          )
        }
        productSales={
          ((productSales as Customer360ProductSale[] | null) ?? []).map((row) =>
            normalizeCustomer360ProductSale(row),
          )
        }
        activities={
          ((activities as SalesActivity[] | null) ?? []).map((row) =>
            normalizeSalesActivity(row),
          )
        }
        loyaltyAccount={
          loyaltyAccount
            ? normalizeLoyaltyAccount(loyaltyAccount as Customer360LoyaltyAccount)
            : null
        }
        loyaltyTransactions={
          ((loyaltyTransactions as Customer360LoyaltyTransaction[] | null) ?? []).map(
            (row) => normalizeLoyaltyTransaction(row),
          )
        }
        fetchError={fetchError}
      />
    </CrmShell>
  );
}
