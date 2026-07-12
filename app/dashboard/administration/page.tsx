import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { mapApproverRows } from "../approver-utils";
import type { Approver, Employee, NamedLookup } from "../lookup-types";
import type { ServiceType } from "../service-types";
import Approvers from "./approvers";
import ExpenseCategories from "./expense-categories";
import ExpenseSubcategories from "./expense-subcategories";
import PaymentMethods from "./payment-methods";
import ServiceCategories from "./service-categories";

export default async function AdministrationPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: serviceTypes, error: serviceTypesError },
    { data: expenseCategories, error: expenseCategoriesError },
    { data: expenseSubcategories, error: expenseSubcategoriesError },
    { data: paymentMethods, error: paymentMethodsError },
    { data: approvers, error: approversError },
    { data: employees, error: employeesError },
  ] = await Promise.all([
    supabase.from("service_types").select("name").order("name", { ascending: true }),
    supabase
      .from("expense_categories")
      .select("name")
      .order("name", { ascending: true }),
    supabase
      .from("expense_subcategories")
      .select("name")
      .order("name", { ascending: true }),
    supabase.from("payment_methods").select("name").order("name", { ascending: true }),
    supabase
      .from("approvers")
      .select("employee_id, employees(full_name)")
      .order("employee_id", { ascending: true }),
    supabase
      .from("employees")
      .select("employee_id, full_name")
      .order("full_name", { ascending: true }),
  ]);

  const mappedApprovers = mapApproverRows(approvers ?? []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Administration
      </h1>
      <div className="space-y-6">
        <ServiceCategories
          initialCategories={(serviceTypes as ServiceType[] | null) ?? []}
          fetchError={serviceTypesError?.message ?? null}
        />
        <ExpenseCategories
          initialCategories={(expenseCategories as NamedLookup[] | null) ?? []}
          fetchError={expenseCategoriesError?.message ?? null}
        />
        <ExpenseSubcategories
          initialSubcategories={
            (expenseSubcategories as NamedLookup[] | null) ?? []
          }
          fetchError={expenseSubcategoriesError?.message ?? null}
        />
        <PaymentMethods
          initialMethods={(paymentMethods as NamedLookup[] | null) ?? []}
          fetchError={paymentMethodsError?.message ?? null}
        />
        <Approvers
          initialApprovers={mappedApprovers as Approver[]}
          initialEmployees={(employees as Employee[] | null) ?? []}
          fetchError={approversError?.message ?? employeesError?.message ?? null}
        />
      </div>
    </div>
  );
}
