import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { runCampaignSend } from "@/utils/campaign-send";
import { CRM_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Campaign id is required." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  try {
    const result = await runCampaignSend(supabase, {
      tenantId: auth.tenantId,
      campaignId: id,
    });
    return NextResponse.json({ result });
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
        : 400;
    const message =
      error instanceof Error ? error.message : "Failed to send campaign.";
    return NextResponse.json({ error: message }, { status });
  }
}
