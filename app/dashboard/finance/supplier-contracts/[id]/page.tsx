import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import type { NamedLookup } from "@/app/dashboard/lookup-types";
import FinanceNav from "../../finance-nav";
import { queryExpenseSubcategoryLookups } from "../../expense-register-utils";
import SupplierContractsWorkspace from "../supplier-contracts-workspace";

export default async function SupplierContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
      supabase.from("expense_categories").select("name").order("name"),
      queryExpenseSubcategoryLookups(supabase),
    ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Supplier Contract</h2>
      <SupplierContractsWorkspace
        initialContracts={[]}
        expenseCategories={(expenseCategories as NamedLookup[] | null) ?? []}
        expenseSubcategories={(expenseSubcategories as NamedLookup[] | null) ?? []}
        detailId={id}
      />
    </div>
  );
}
