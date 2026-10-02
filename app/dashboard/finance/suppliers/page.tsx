import { Suspense } from "react";
import { cookies } from "next/headers";
import { getCurrentUserRole, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  canEditInventory,
  isFinanceSuppliersOnlyRole,
} from "@/utils/rbac-access";
import {
  normalizeSupplier,
  SUPPLIER_SELECT,
  type SupplierRow,
} from "@/utils/suppliers-types";
import FinanceNav from "../finance-nav";
import SuppliersList from "./suppliers-list";

const SUPPLIERS_DESCRIPTION =
  "Supplier master data used across expenses, payables, supplier contracts, fixed assets and purchasing. Inactive suppliers stay in history but are hidden from dropdowns.";

export default async function FinanceSuppliersPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </div>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("suppliers")
    .select(SUPPLIER_SELECT)
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  const role = (await getCurrentUserRole()) as AppRole | null;
  const suppliersOnly = isFinanceSuppliersOnlyRole(role);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav suppliersOnly={suppliersOnly} />
      <h2 className="mb-2 text-xl font-semibold text-[#0f2744]">Suppliers</h2>
      <p className="mb-6 text-sm text-slate-600">{SUPPLIERS_DESCRIPTION}</p>
      <Suspense
        fallback={
          <p className="text-sm text-slate-600">Loading suppliers…</p>
        }
      >
        <SuppliersList
          initialSuppliers={
            ((data as SupplierRow[] | null) ?? []).map((row) =>
              normalizeSupplier(row),
            )
          }
          fetchError={error?.message ?? null}
          readOnly={!canEditInventory(role)}
        />
      </Suspense>
    </div>
  );
}
