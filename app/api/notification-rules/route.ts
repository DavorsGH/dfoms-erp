import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { assertTenantHasFeature } from "@/utils/tier-access";
import { defaultChannelFromTemplate } from "@/utils/transactional-notification-types";
import { CRM_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";
import {
  mergeRulesWithDefaults,
  validateRuleUpsert,
  type TransactionalNotificationRuleInput,
} from "@/utils/transactional-notification-types";

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

export async function GET() {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }
  const feature = await assertTenantHasFeature(auth.tenantId, "email_promotions");
  if (!feature.ok) {
    return feature.response;
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("transactional_notification_rules")
    .select(
      "id, tenant_id, event_type, template_id, channel, is_active, message_templates(name)",
    )
    .eq("tenant_id", auth.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rules = mergeRulesWithDefaults(
    auth.tenantId,
    (data as Parameters<typeof mergeRulesWithDefaults>[1]) ?? [],
  );

  return NextResponse.json({ rules });
}

export async function PUT(request: Request) {
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

  const body = rawBody as TransactionalNotificationRuleInput;
  const validationError = validateRuleUpsert(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const eventType = body.event_type!.trim();
  const templateId = body.template_id!.trim();
  const supabase = await getTenantSupabase();

  const { data: template, error: templateError } = await supabase
    .from("message_templates")
    .select("id, channel, template_type, is_active, name")
    .eq("id", templateId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (templateError) {
    return NextResponse.json({ error: templateError.message }, { status: 400 });
  }
  if (!template) {
    return NextResponse.json(
      { error: "Template not found in this workspace." },
      { status: 404 },
    );
  }
  if (template.is_active !== true) {
    return NextResponse.json(
      { error: "Select an active template." },
      { status: 400 },
    );
  }
  if (template.template_type !== "transactional") {
    return NextResponse.json(
      { error: "Notification rules require a transactional template." },
      { status: 400 },
    );
  }

  const channel = defaultChannelFromTemplate(String(template.channel));
  const isActive = body.is_active === true;
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("transactional_notification_rules")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("event_type", eventType)
    .maybeSingle();

  let saved;
  if (existing?.id) {
    const { data, error } = await supabase
      .from("transactional_notification_rules")
      .update({
        template_id: templateId,
        channel,
        is_active: isActive,
        updated_at: now,
      })
      .eq("id", existing.id)
      .eq("tenant_id", auth.tenantId)
      .select(
        "id, tenant_id, event_type, template_id, channel, is_active, message_templates(name)",
      )
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    saved = data;
  } else {
    const { data, error } = await supabase
      .from("transactional_notification_rules")
      .insert({
        tenant_id: auth.tenantId,
        event_type: eventType,
        template_id: templateId,
        channel,
        is_active: isActive,
        created_at: now,
        updated_at: now,
      })
      .select(
        "id, tenant_id, event_type, template_id, channel, is_active, message_templates(name)",
      )
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    saved = data;
  }

  const rules = mergeRulesWithDefaults(auth.tenantId, saved ? [saved as never] : []);
  const rule = rules.find((row) => row.event_type === eventType) ?? null;

  // Re-fetch all so response stays consistent with GET shape.
  const { data: allRows } = await supabase
    .from("transactional_notification_rules")
    .select(
      "id, tenant_id, event_type, template_id, channel, is_active, message_templates(name)",
    )
    .eq("tenant_id", auth.tenantId);

  return NextResponse.json({
    rule,
    rules: mergeRulesWithDefaults(
      auth.tenantId,
      (allRows as Parameters<typeof mergeRulesWithDefaults>[1]) ?? [],
    ),
  });
}
