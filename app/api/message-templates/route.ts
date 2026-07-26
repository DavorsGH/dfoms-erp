import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { CRM_SECTION_ROLES } from "@/utils/rbac-access";
import {
  MESSAGE_TEMPLATE_SELECT,
  normalizeMessageTemplateRow,
  trimMessageTemplateInput,
  validateMessageTemplateInput,
  type MessageTemplateInput,
  type MessageTemplateRow,
} from "@/utils/message-templates-types";
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

export async function GET(request: Request) {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const typeFilter = searchParams.get("type")?.trim() ?? "";
  const channelFilter = searchParams.get("channel")?.trim() ?? "";
  const includeInactive = searchParams.get("include_inactive") === "1";

  const supabase = await getTenantSupabase();
  let query = supabase
    .from("message_templates")
    .select(MESSAGE_TEMPLATE_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("updated_at", { ascending: false });

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }
  if (typeFilter) {
    query = query.eq("template_type", typeFilter);
  }
  if (channelFilter) {
    query = query.eq("channel", channelFilter);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const templates = ((data as MessageTemplateRow[] | null) ?? []).map(
    normalizeMessageTemplateRow,
  );

  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
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

  const body = rawBody as MessageTemplateInput;
  const validationError = validateMessageTemplateInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimMessageTemplateInput(body);
  const supabase = await getTenantSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("message_templates")
    .insert({
      tenant_id: auth.tenantId,
      ...trimmed,
      created_by: user?.id ?? null,
      created_at: now,
      updated_at: now,
    })
    .select(MESSAGE_TEMPLATE_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    template: normalizeMessageTemplateRow(data as MessageTemplateRow),
  });
}
