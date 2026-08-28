import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserRole, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import {
  CONTRACT_PROJECT_SELECT,
  type ContractProjectOption,
} from "../../administration/projects-utils";
import InventoryShell from "../inventory-shell";
import RawMaterials from "../raw-materials";
import {
  normalizeRawMaterial,
  normalizeRawMaterialPurchase,
  RAW_MATERIAL_PURCHASE_SELECT,
  RAW_MATERIAL_SELECT,
  type RawMaterialPurchaseRecord,
  type RawMaterialRecord,
} from "../raw-materials-utils";
import type { NamedLookup } from "../../lookup-types";

export default async function RawMaterialsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  const [
    { data: materials, error: materialsError },
    { data: purchases, error: purchasesError },
    { data: paymentMethods, error: paymentMethodsError },
    { data: projects, error: projectsError },
  ] = await Promise.all([
    supabase
      .from("raw_materials")
      .select(RAW_MATERIAL_SELECT)
      .order("material_name", { ascending: true }),
    supabase
      .from("raw_material_purchases")
      .select(RAW_MATERIAL_PURCHASE_SELECT)
      .order("purchase_date", { ascending: false }),
    supabase
      .from("payment_methods")
      .select("name")
      .order("name", { ascending: true }),
    tenantId
      ? supabase
          .from("projects")
          .select(CONTRACT_PROJECT_SELECT)
          .eq("tenant_id", tenantId)
          .order("project_name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <InventoryShell sectionTitle="Raw Materials">
      <RawMaterials
        initialMaterials={
          (materials as RawMaterialRecord[] | null)?.map((row) =>
            normalizeRawMaterial(row),
          ) ?? []
        }
        initialPurchases={
          (purchases as RawMaterialPurchaseRecord[] | null)?.map((row) =>
            normalizeRawMaterialPurchase(row),
          ) ?? []
        }
        initialPaymentMethods={(paymentMethods as NamedLookup[] | null) ?? []}
        initialProjects={(projects as ContractProjectOption[] | null) ?? []}
        fetchError={
          materialsError?.message ??
          purchasesError?.message ??
          paymentMethodsError?.message ??
          projectsError?.message ??
          null
        }
        readOnly={!canEditInventory(role)}
      />
    </InventoryShell>
  );
}
