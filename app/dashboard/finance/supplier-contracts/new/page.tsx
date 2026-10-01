import { cookies } from "next/headers";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import type { NamedLookup } from "@/app/dashboard/lookup-types";
import FinanceNav from "../../finance-nav";
import {
  normalizeExpenseSubcategoryLookup,
  queryExpenseSubcategoryLookups,
} from "../../expense-register-utils";
import SupplierContractCreateForm from "../supplier-contract-create-form";

export default async function NewSupplierContractPage() {
  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
        <FinanceNav />
        <p className="text-sm text-red-700">Unable to resolve workspace.</p>
      </div>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [{ data: expenseCategories }, { data: expenseSubcategories }] =
    await Promise.all([
      supabase
        .from("expense_categories")
        .select("name, is_active")
        .order("name"),
      queryExpenseSubcategoryLookups(supabase),
    ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[#0f2744]">New Supplier Contract</h2>
        <Link
          href="/dashboard/finance/supplier-contracts"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744]"
        >
          Back
        </Link>
      </div>
      <SupplierContractCreateForm
        expenseCategories={(expenseCategories as NamedLookup[] | null) ?? []}
        expenseSubcategories={(expenseSubcategories ?? []).map((row) =>
          normalizeExpenseSubcategoryLookup(row),
        )}
      />
    </div>
  );
}
