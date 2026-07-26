import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { CRM_SECTION_ROLES } from "@/utils/rbac-access";
import {
  CAMPAIGN_SELECT,
  channelsCompatible,
  defaultChannelFromTemplate,
  isDraftStatus,
  normalizeCampaignRow,
  trimCampaignInput,
  validateCampaignInput,
  type CampaignAudienceFilter,
  type CampaignInput,
  type CampaignRow,
} from "@/utils/campaigns-types";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

function rejectClientTenantId(body: unknown): NextResponse | null {
  if (body !== null && typeof body === "object" && "tenant_id" in body) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client." },
      { status: 400 },
    );
  }
  return null;
}

async function loadActiveTemplate(
  supabase: SupabaseClient,
  tenantId: string,
  templateId: string,
): Promise<
  | { ok: true; channel: string }
  | { ok: false; error: string; status: number }
> {
  const { data, error } = await supabase
    .from("message_templates")
    .select("id, channel, is_active, tenant_id")
    .eq("id", templateId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }
  if (!data) {
    return {
      ok: false,
      error: "Template not found in this workspace.",
      status: 404,
    };
  }
  if (data.is_active !== true) {
    return {
      ok: false,
      error: "Select an active message template.",
      status: 400,
    };
  }

  return { ok: true, channel: String(data.channel) };
}

async function countAudienceRecipients(
  supabase: SupabaseClient,
  tenantId: string,
  audience: CampaignAudienceFilter,
): Promise<number> {
  let query = supabase
    .from("customers")
    .select("client_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "active");

  if (audience.type === "customer_type") {
    query = query.eq("customer_type", audience.value);
  }

  const { count, error } = await query;
  if (error) {
    console.error("[campaigns] audience count failed:", error.message);
    return 0;
  }

  return count ?? 0;
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Campaign id is required." }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const tenantRejection = rejectClientTenantId(rawBody);
  if (tenantRejection) {
    return tenantRejection;
  }

  const body = rawBody as CampaignInput;
  const validationError = validateCampaignInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimCampaignInput(body);
  const supabase = await getTenantSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (!isDraftStatus(String(existing.status))) {
    return NextResponse.json(
      {
        error:
          "Only draft campaigns can be edited. This campaign has already progressed past draft.",
      },
      { status: 400 },
    );
  }

  const template = await loadActiveTemplate(
    supabase,
    auth.tenantId,
    trimmed.template_id,
  );
  if (!template.ok) {
    return NextResponse.json(
      { error: template.error },
      { status: template.status },
    );
  }

  const channel = defaultChannelFromTemplate(template.channel);
  if (!channelsCompatible(template.channel, channel)) {
    return NextResponse.json(
      { error: "Campaign channel is not compatible with the selected template." },
      { status: 400 },
    );
  }

  const totalRecipients = await countAudienceRecipients(
    supabase,
    auth.tenantId,
    trimmed.audience_filter,
  );

  const { data, error } = await supabase
    .from("campaigns")
    .update({
      name: trimmed.name,
      template_id: trimmed.template_id,
      channel,
      audience_filter: trimmed.audience_filter,
      total_recipients: totalRecipients,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select(CAMPAIGN_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    campaign: normalizeCampaignRow(data as unknown as CampaignRow),
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Campaign id is required." }, { status: 400 });
  }

  const supabase = await getTenantSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (!isDraftStatus(String(existing.status))) {
    return NextResponse.json(
      {
        error:
          "Only draft campaigns can be deleted. This campaign has already progressed past draft.",
      },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", id)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
