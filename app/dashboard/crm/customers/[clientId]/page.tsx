import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
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
  CUSTOMER_360_OPPORTUNITY_SELECT,
  CUSTOMER_360_PRODUCT_SALE_SELECT,
  CUSTOMER_360_QUOTE_SELECT,
  normalizeCustomer360Invoice,
  normalizeCustomer360Opportunity,
  normalizeCustomer360ProductSale,
  normalizeCustomer360Quote,
  type Customer360Invoice,
  type Customer360Opportunity,
  type Customer360ProductSale,
  type Customer360Quote,
} from "../customer-360-utils";
import type { CustomerEntry } from "../customers-utils";

type CustomerDetailPageProps = {
  params: Promise<{ clientId: string }>;
};

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  const { clientId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: customer, error: customerError },
    { data: employees, error: employeesError },
    { data: opportunities, error: opportunitiesError },
    { data: quotes, error: quotesError },
    { data: invoices, error: invoicesError },
    { data: productSales, error: productSalesError },
    { data: activities, error: activitiesError },
  ] = await Promise.all([
    supabase.from("customers").select("*").eq("client_id", clientId).maybeSingle(),
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    supabase
      .from("sales_opportunities")
      .select(CUSTOMER_360_OPPORTUNITY_SELECT)
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("sales_quotes")
      .select(CUSTOMER_360_QUOTE_SELECT)
      .eq("client_id", clientId)
      .order("quote_date", { ascending: false }),
    supabase
      .from("client_invoices")
      .select(CUSTOMER_360_INVOICE_SELECT)
      .eq("client_id", clientId)
      .order("invoice_date", { ascending: false }),
    supabase
      .from("income_register")
      .select(CUSTOMER_360_PRODUCT_SALE_SELECT)
      .eq("client_id", clientId)
      .eq("entry_type", "product_sale")
      .order("date", { ascending: false }),
    supabase
      .from("sales_activities")
      .select(SALES_ACTIVITY_SELECT)
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
    : "—";

  const fetchError =
    (customerError as { message?: string } | null)?.message ??
    (employeesError as { message?: string } | null)?.message ??
    (opportunitiesError as { message?: string } | null)?.message ??
    (quotesError as { message?: string } | null)?.message ??
    (invoicesError as { message?: string } | null)?.message ??
    (productSalesError as { message?: string } | null)?.message ??
    (activitiesError as { message?: string } | null)?.message ??
    null;

  return (
    <CrmShell sectionTitle="Customer List">
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
        fetchError={fetchError}
      />
    </CrmShell>
  );
}
