import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { EMPLOYEE_ANNOUNCEMENTS_ROLES } from "@/utils/rbac-access";
import { countEmployeeAudienceRecipients } from "@/utils/employee-announcements-audience";
import {
  EMPLOYEE_ANNOUNCEMENT_SELECT,
  isDraftStatus,
  normalizeEmployeeAnnouncementRow,
  trimEmployeeAnnouncementInput,
  validateEmployeeAnnouncementInput,
  type EmployeeAnnouncementInput,
  type EmployeeAnnouncementRow,
} from "@/utils/employee-announcements-types";
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

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(EMPLOYEE_ANNOUNCEMENTS_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: "Announcement id is required." },
      { status: 400 },
    );
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

  const { data: existing, error: fetchError } = await supabase
    .from("employee_announcements")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Announcement not found." }, { status: 404 });
  }
  if (!isDraftStatus(String(existing.status))) {
    return NextResponse.json(
      {
        error:
          "Only draft announcements can be edited. This announcement has already progressed past draft.",
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
  }

  const totalRecipients = await countEmployeeAudienceRecipients(
    supabase,
    auth.tenantId,
    trimmed.audience_filter,
  );

  const { data, error } = await supabase
    .from("employee_announcements")
    .update({
      name: trimmed.name,
      template_id: trimmed.template_id,
      channels: trimmed.channels,
      subject: trimmed.subject,
      body: trimmed.body,
      audience_filter: trimmed.audience_filter,
      total_recipients: totalRecipients,
    })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
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

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(EMPLOYEE_ANNOUNCEMENTS_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: "Announcement id is required." },
      { status: 400 },
    );
  }

  const supabase = await getTenantSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from("employee_announcements")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Announcement not found." }, { status: 404 });
  }
  if (!isDraftStatus(String(existing.status))) {
    return NextResponse.json(
      {
        error:
          "Only draft announcements can be deleted. This announcement has already progressed past draft.",
      },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("employee_announcements")
    .delete()
    .eq("id", id)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
