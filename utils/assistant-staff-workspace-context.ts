import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Staff assistant: tenant + business units are one company with internal divisions.
 * Uses live tenant data — no hard-coded customer names.
 */
export async function buildStaffWorkspaceStructurePrompt(
  tenantId: string,
  supabase?: SupabaseClient,
): Promise<string | null> {
  const client = supabase ?? createAdminClient();

  const [{ data: tenant }, { data: units }] = await Promise.all([
    client.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    client
      .from("business_units")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const companyName = tenant?.name?.trim();
  if (!companyName) {
    return null;
  }

  const unitNames = (units ?? [])
    .map((row) => row.name?.trim())
    .filter((name): name is string => Boolean(name));

  const unitList =
    unitNames.length > 0
      ? unitNames.join(", ")
      : "none configured yet";

  return [
    "Workspace structure (this signed-in tenant):",
    `The workspace is one company, "${companyName}".`,
    `Business units (${unitList}) are divisions of that company, not separate companies.`,
    "Figures can be viewed per unit or for All businesses; transfers between units are internal.",
    "When the user names a business unit, treat it as part of this workspace unless they clearly mean a different tenant on the platform.",
    "If the user compares two names that both appear in the business unit list above, they are divisions of the same company — not separate companies and not separate platform tenants.",
  ].join(" ");
}
