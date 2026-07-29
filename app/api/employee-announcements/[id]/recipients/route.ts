import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { buildEmployeeVariables } from "@/utils/employee-announcement-send";
import type { AnnouncementEmployee } from "@/utils/employee-announcements-audience";
import { EMPLOYEE_ANNOUNCEMENTS_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type TemplateJoin = {
  name: string;
  channel: string;
  subject: string | null;
  body: string;
};

export async function GET(_request: Request, context: RouteContext) {
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

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: announcement, error: announcementError } = await supabase
    .from("employee_announcements")
    .select(
      "id, name, channels, status, subject, body, template_id, total_recipients, employee_message_templates(name, channel, subject, body)",
    )
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (announcementError) {
    return NextResponse.json(
      { error: announcementError.message },
      { status: 400 },
    );
  }
  if (!announcement) {
    return NextResponse.json(
      { error: "Announcement not found." },
      { status: 404 },
    );
  }

  const { data: recipients, error: recipientsError } = await supabase
    .from("employee_announcement_recipients")
    .select("id, employee_id, channel, status, sent_at, error_detail")
    .eq("announcement_id", id)
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: true });

  if (recipientsError) {
    return NextResponse.json(
      { error: recipientsError.message },
      { status: 400 },
    );
  }

  const employeeIds = [
    ...new Set((recipients ?? []).map((row) => row.employee_id).filter(Boolean)),
  ];

  const employeeById = new Map<
    string,
    {
      employee_id: string;
      staff_id: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      position: string | null;
      shift: string | null;
      employment_type: string | null;
    }
  >();

  if (employeeIds.length > 0) {
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, email, phone, position, shift, employment_type",
      )
      .eq("tenant_id", auth.tenantId)
      .in("employee_id", employeeIds);

    if (employeesError) {
      return NextResponse.json(
        { error: employeesError.message },
        { status: 400 },
      );
    }

    for (const row of employees ?? []) {
      employeeById.set(row.employee_id, row);
    }
  }

  const rawTemplate = announcement.employee_message_templates;
  const templateJoin = (
    Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate
  ) as TemplateJoin | null;

  const subject =
    templateJoin?.subject?.trim() ||
    (typeof announcement.subject === "string"
      ? announcement.subject.trim()
      : "") ||
    null;
  const body =
    templateJoin?.body?.trim() ||
    (typeof announcement.body === "string" ? announcement.body.trim() : "") ||
    "";

  const normalizedRecipients = (recipients ?? []).map((row) => {
    const employee = employeeById.get(row.employee_id) ?? null;
    return {
      id: row.id,
      employee_id: row.employee_id,
      channel: row.channel,
      status: row.status,
      sent_at: row.sent_at,
      error_detail: row.error_detail,
      employee_name: employee?.full_name ?? row.employee_id,
      staff_id: employee?.staff_id ?? null,
      email: employee?.email ?? null,
      phone: employee?.phone ?? null,
      position: employee?.position ?? null,
      shift: employee?.shift ?? null,
      employment_type: employee?.employment_type ?? null,
    };
  });

  let sample_variables: Record<string, string> | null = null;
  const sampleRow = normalizedRecipients.find((r) => r.staff_id);
  if (sampleRow) {
    const sampleEmployee: AnnouncementEmployee = {
      employee_id: sampleRow.employee_id,
      staff_id: sampleRow.staff_id ?? sampleRow.employee_id,
      full_name: sampleRow.employee_name,
      email: sampleRow.email,
      phone: sampleRow.phone,
      position: sampleRow.position,
      shift: sampleRow.shift,
      employment_type: sampleRow.employment_type,
      employment_status: "Active",
    };
    sample_variables = buildEmployeeVariables(sampleEmployee);
  }

  return NextResponse.json({
    announcement: {
      id: announcement.id,
      name: announcement.name,
      channels: announcement.channels,
      status: announcement.status,
      total_recipients: announcement.total_recipients,
    },
    content: {
      template_name: templateJoin?.name ?? null,
      subject,
      body,
      channels: announcement.channels as string[],
    },
    sample_variables,
    recipients: normalizedRecipients,
  });
}
