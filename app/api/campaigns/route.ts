import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { assertTenantHasFeature } from "@/utils/tier-access";
import { CRM_SECTION_ROLES } from "@/utils/rbac-access";
import {
  CAMPAIGN_CODE_ENTITY_TYPE,
  CAMPAIGN_SELECT,
  channelsCompatible,
  defaultChannelFromTemplate,
  normalizeCampaignRow,
  trimCampaignInput,
  validateCampaignInput,
  type CampaignAudienceFilter,
  type CampaignInput,
  type CampaignRow,
} from "@/utils/campaigns-types";
import { createClient } from "@/utils/supabase/server";

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

async function allocateCampaignCode(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ code: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: CAMPAIGN_CODE_ENTITY_TYPE,
    p_padding: 4,
  });

  if (error) {
    return { code: null, error: error.message };
  }

  const code = typeof data === "string" ? data.trim() : "";
  if (!code) {
    return {
      code: null,
      error: "generate_next_code returned an empty campaign code.",
    };
  }

  return { code, error: null };
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

export async function GET(request: Request) {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }
  const feature = await assertTenantHasFeature(auth.tenantId, "email_promotions");
  if (!feature.ok) {
    return feature.response;
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status")?.trim() ?? "";

  const supabase = await getTenantSupabase();
  let query = supabase
    .from("campaigns")
    .select(CAMPAIGN_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const campaigns = ((data as unknown as CampaignRow[] | null) ?? []).map(
    normalizeCampaignRow,
  );

  return NextResponse.json({ campaigns });
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }
  const feature = await assertTenantHasFeature(auth.tenantId, "email_promotions");
  if (!feature.ok) {
    return feature.response;
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

  // Channel is owned by the template for v1 — ignore mismatched client values.
  const channel = defaultChannelFromTemplate(template.channel);
  if (!channelsCompatible(template.channel, channel)) {
    return NextResponse.json(
      { error: "Campaign channel is not compatible with the selected template." },
      { status: 400 },
    );
  }

  const allocated = await allocateCampaignCode(supabase, auth.tenantId);
  if (allocated.error || !allocated.code) {
    return NextResponse.json(
      { error: allocated.error ?? "Failed to allocate campaign code." },
      { status: 500 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const totalRecipients = await countAudienceRecipients(
    supabase,
    auth.tenantId,
    trimmed.audience_filter,
  );

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      tenant_id: auth.tenantId,
      campaign_code: allocated.code,
      name: trimmed.name,
      template_id: trimmed.template_id,
      channel,
      audience_filter: trimmed.audience_filter,
      status: "draft",
      total_recipients: totalRecipients,
      created_by: user?.id ?? null,
      created_at: now,
      updated_at: now,
    })
    .select(CAMPAIGN_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    campaign: normalizeCampaignRow(data as unknown as CampaignRow),
  });
}
