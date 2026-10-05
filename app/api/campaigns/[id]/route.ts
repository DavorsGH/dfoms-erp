import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { assertTenantHasFeature } from "@/utils/tier-access";
import { CRM_FULL_FEATURE_ROLES } from "@/utils/rbac-access";
import {
  countCampaignAudienceRecipients,
  sanitizeFilteredClientIds,
} from "@/utils/campaign-audience";
import {
  CAMPAIGN_SELECT,
  channelsCompatible,
  filteredCampaignAudienceHasCriteria,
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

async function resolveAudienceForSave(
  supabase: SupabaseClient,
  tenantId: string,
  audience: CampaignAudienceFilter,
): Promise<CampaignAudienceFilter | null> {
  if (audience.type !== "filtered") {
    return audience;
  }

  const client_ids = await sanitizeFilteredClientIds(
    supabase,
    tenantId,
    audience.client_ids,
  );
  const resolved: CampaignAudienceFilter = {
    ...audience,
    client_ids,
  };
  if (!filteredCampaignAudienceHasCriteria(resolved)) {
    return null;
  }
  return resolved;
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(CRM_FULL_FEATURE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }
  const feature = await assertTenantHasFeature(auth.tenantId, "email_promotions");
  if (!feature.ok) {
    return feature.response;
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

  const audienceForSave = await resolveAudienceForSave(
    supabase,
    auth.tenantId,
    trimmed.audience_filter,
  );
  if (!audienceForSave) {
    return NextResponse.json(
      {
        error:
          "Audience must be all customers, or at least one customer type or named customer.",
      },
      { status: 400 },
    );
  }

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

  if (trimmed.template_id) {
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

    if (!channelsCompatible(template.channel, trimmed.channel)) {
      return NextResponse.json(
        {
          error:
            "Campaign channels are not compatible with the selected template.",
        },
        { status: 400 },
      );
    }
  }

  const channel = trimmed.channel;

  const totalRecipients = await countCampaignAudienceRecipients(
    supabase,
    auth.tenantId,
    audienceForSave,
  );

  const { data, error } = await supabase
    .from("campaigns")
    .update({
      name: trimmed.name,
      template_id: trimmed.template_id,
      channel,
      subject: trimmed.template_id ? null : trimmed.subject,
      body_email: trimmed.template_id ? null : trimmed.body_email,
      body_sms: trimmed.template_id ? null : trimmed.body_sms,
      audience_filter: audienceForSave,
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
  const auth = await requireTenantRoleIn(CRM_FULL_FEATURE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }
  const feature = await assertTenantHasFeature(auth.tenantId, "email_promotions");
  if (!feature.ok) {
    return feature.response;
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
