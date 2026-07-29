import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { EMPLOYEE_ANNOUNCEMENTS_ROLES } from "@/utils/rbac-access";
import { countEmployeeAudienceRecipients } from "@/utils/employee-announcements-audience";
import {
  ANNOUNCEMENT_CODE_ENTITY_TYPE,
  EMPLOYEE_ANNOUNCEMENT_SELECT,
  normalizeEmployeeAnnouncementRow,
  trimEmployeeAnnouncementInput,
  validateEmployeeAnnouncementInput,
  type EmployeeAnnouncementInput,
  type EmployeeAnnouncementRow,
} from "@/utils/employee-announcements-types";
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

async function allocateAnnouncementCode(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ code: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: ANNOUNCEMENT_CODE_ENTITY_TYPE,
    p_padding: 4,
  });

  if (error) {
    return { code: null, error: error.message };
  }

  const code = typeof data === "string" ? data.trim() : "";
  if (!code) {
    return {
      code: null,
      error: "generate_next_code returned an empty announcement code.",
    };
  }

  return { code, error: null };
}

async function loadActiveTemplate(
  supabase: SupabaseClient,
  tenantId: string,
  templateId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data, error } = await supabase
    .from("employee_message_templates")
    .select("id, is_active, tenant_id")
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

  return { ok: true };
}

export async function GET(request: Request) {
  const auth = await requireTenantRoleIn(EMPLOYEE_ANNOUNCEMENTS_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status")?.trim() ?? "";

  const supabase = await getTenantSupabase();
  let query = supabase
    .from("employee_announcements")
    .select(EMPLOYEE_ANNOUNCEMENT_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const announcements = (
    (data as unknown as EmployeeAnnouncementRow[] | null) ?? []
  ).map(normalizeEmployeeAnnouncementRow);

  return NextResponse.json({ announcements });
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(EMPLOYEE_ANNOUNCEMENTS_ROLES);
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

  const body = rawBody as EmployeeAnnouncementInput;
  const validationError = validateEmployeeAnnouncementInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimEmployeeAnnouncementInput(body);
  const supabase = await getTenantSupabase();

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
  }

  const allocated = await allocateAnnouncementCode(supabase, auth.tenantId);
  if (allocated.error || !allocated.code) {
    return NextResponse.json(
      { error: allocated.error ?? "Failed to allocate announcement code." },
      { status: 500 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const totalRecipients = await countEmployeeAudienceRecipients(
    supabase,
    auth.tenantId,
    trimmed.audience_filter,
  );

  const { data, error } = await supabase
    .from("employee_announcements")
    .insert({
      tenant_id: auth.tenantId,
      announcement_code: allocated.code,
      name: trimmed.name,
      template_id: trimmed.template_id,
      channels: trimmed.channels,
      subject: trimmed.subject,
      body: trimmed.body,
      audience_filter: trimmed.audience_filter,
      status: "draft",
      total_recipients: totalRecipients,
      created_by: user?.id ?? null,
    })
    .select(EMPLOYEE_ANNOUNCEMENT_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    announcement: normalizeEmployeeAnnouncementRow(
      data as unknown as EmployeeAnnouncementRow,
    ),
  });
}
