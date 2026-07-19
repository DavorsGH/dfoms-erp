import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import { getRoleLabel } from "../../role-labels";
import { CONTRACT_PROJECT_SELECT } from "../../administration/projects-utils";
import { CLIENT_SELECT } from "../../operations/clients-utils";
import { SITE_ASSIGNMENT_SELECT, normalizeSiteEntry, type SiteEntry } from "../../operations/sites-utils";
import InventoryShell from "../inventory-shell";
import InternalConsumption from "../internal-consumption";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../finished-products-utils";
import {
  INTERNAL_CONSUMPTION_SELECT,
  normalizeInternalConsumption,
  type InternalConsumptionRecord,
} from "../internal-consumption-utils";

async function getRecordedByLabel(
  supabase: ReturnType<typeof createClient>,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? "Unknown user";

  if (!user) {
    return email;
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("employee_id, role")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (!account?.employee_id) {
    return email;
  }

  const { data: employee } = await supabase
    .from("employees")
    .select("full_name")
    .eq("employee_id", account.employee_id)
    .maybeSingle();

  if (employee?.full_name) {
    return account.role
      ? `${employee.full_name} [${getRoleLabel(account.role)}]`
      : employee.full_name;
  }

  return email;
}

export default async function InternalConsumptionPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: entries, error: entriesError },
    { data: products, error: productsError },
    { data: projects, error: projectsError },
    { data: sites, error: sitesError },
    recordedByLabel,
  ] = await Promise.all([
    supabase
      .from("internal_consumption")
      .select(INTERNAL_CONSUMPTION_SELECT)
      .order("consumption_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .order("product_name", { ascending: true }),
    supabase
      .from("projects")
      .select(CONTRACT_PROJECT_SELECT)
      .order("project_name", { ascending: true }),
    supabase
      .from("sites")
      .select(SITE_ASSIGNMENT_SELECT)
      .order("site_name", { ascending: true }),
    getRecordedByLabel(supabase),
  ]);

  const fetchError =
    entriesError?.message ??
    productsError?.message ??
    projectsError?.message ??
    sitesError?.message ??
    null;

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <InventoryShell sectionTitle="Internal Consumption">
      <InternalConsumption
        initialEntries={
          ((entries as InternalConsumptionRecord[] | null) ?? []).map((row) =>
            normalizeInternalConsumption(row),
          )
        }
        initialProducts={
          ((products as FinishedProductRecord[] | null) ?? []).map((row) =>
            normalizeFinishedProduct(row),
          )
        }
        initialProjects={projects ?? []}
        initialSites={(sites ?? []).map((row) =>
          normalizeSiteEntry(row as unknown as SiteEntry),
        )}
        recordedByLabel={recordedByLabel}
        fetchError={fetchError}
        readOnly={!canEditInventory(role)}
      />
    </InventoryShell>
  );
}
