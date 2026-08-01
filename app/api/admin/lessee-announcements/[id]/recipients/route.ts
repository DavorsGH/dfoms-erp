import { NextResponse } from "next/server";
import { buildLesseeVariables } from "@/utils/lessee-announcement-send";
import type { AnnouncementLessee } from "@/utils/lessee-announcements-audience";
import {
  readTenantIdFromSearchParams,
  requireLesseeAnnouncementAdmin,
} from "@/utils/lessee-announcements-admin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type TemplateJoin = {
  name: string;
  channel: string;
  subject: string | null;
  body: string;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: "Announcement id is required." },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(request.url);
  const ctx = await requireLesseeAnnouncementAdmin(
    readTenantIdFromSearchParams(searchParams),
  );
  if (!ctx.ok) return ctx.response;

  const { data: announcement, error: announcementError } = await ctx.admin
    .from("lessee_announcements")
    .select(
      "id, name, channels, status, subject, body, template_id, total_recipients, lessee_message_templates(name, channel, subject, body)",
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
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

  const { data: recipients, error: recipientsError } = await ctx.admin
    .from("lessee_announcement_recipients")
    .select("id, lessee_id, channel, status, sent_at, error_detail")
    .eq("announcement_id", id)
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: true });

  if (recipientsError) {
    return NextResponse.json(
      { error: recipientsError.message },
      { status: 400 },
    );
  }

  const lesseeIds = [
    ...new Set((recipients ?? []).map((row) => row.lessee_id).filter(Boolean)),
  ];

  const lesseeById = new Map<
    string,
    {
      lessee_id: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      auth_user_id: string | null;
    }
  >();

  if (lesseeIds.length > 0) {
    const { data: lessees, error: lesseesError } = await ctx.admin
      .from("lessees")
      .select("lessee_id, full_name, email, phone, auth_user_id")
      .eq("tenant_id", ctx.tenantId)
      .in("lessee_id", lesseeIds);

    if (lesseesError) {
      return NextResponse.json(
        { error: lesseesError.message },
        { status: 400 },
      );
    }

    for (const row of lessees ?? []) {
      lesseeById.set(row.lessee_id, row);
    }
  }

  const rawTemplate = announcement.lessee_message_templates;
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
    const lessee = lesseeById.get(row.lessee_id) ?? null;
    return {
      id: row.id,
      lessee_id: row.lessee_id,
      channel: row.channel,
      status: row.status,
      sent_at: row.sent_at,
      error_detail: row.error_detail,
      lessee_name: lessee?.full_name ?? row.lessee_id,
      email: lessee?.email ?? null,
      phone: lessee?.phone ?? null,
      has_portal: Boolean(lessee?.auth_user_id),
    };
  });

  let sample_variables: Record<string, string> | null = null;
  const sampleRow = normalizedRecipients[0];
  if (sampleRow) {
    const sampleLessee: AnnouncementLessee = {
      lessee_id: sampleRow.lessee_id,
      full_name: sampleRow.lessee_name,
      email: sampleRow.email,
      phone: sampleRow.phone,
      status: "active",
      auth_user_id: sampleRow.has_portal ? "sample" : null,
    };
    sample_variables = buildLesseeVariables(sampleLessee);
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
