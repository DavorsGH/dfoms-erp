import { NextResponse } from "next/server";
import { countLesseeAudienceRecipients } from "@/utils/lessee-announcements-audience";
import {
  allocateLesseeAnnouncementCode,
  loadActiveLesseeTemplate,
  readTenantIdFromBody,
  readTenantIdFromSearchParams,
  requireLesseeAnnouncementAdmin,
} from "@/utils/lessee-announcements-admin";
import {
  LESSEE_ANNOUNCEMENT_SELECT,
  normalizeLesseeAnnouncementRow,
  trimLesseeAnnouncementInput,
  validateLesseeAnnouncementInput,
  type LesseeAnnouncementInput,
  type LesseeAnnouncementRow,
} from "@/utils/lessee-announcements-types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ctx = await requireLesseeAnnouncementAdmin(
    readTenantIdFromSearchParams(searchParams),
  );
  if (!ctx.ok) return ctx.response;

  const statusFilter = searchParams.get("status")?.trim() ?? "";

  let query = ctx.admin
    .from("lessee_announcements")
    .select(LESSEE_ANNOUNCEMENT_SELECT)
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const announcements = (
    (data as unknown as LesseeAnnouncementRow[] | null) ?? []
  ).map(normalizeLesseeAnnouncementRow);

  return NextResponse.json({ announcements });
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const ctx = await requireLesseeAnnouncementAdmin(readTenantIdFromBody(rawBody));
  if (!ctx.ok) return ctx.response;

  const body = rawBody as LesseeAnnouncementInput;
  const validationError = validateLesseeAnnouncementInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimLesseeAnnouncementInput(body);

  if (trimmed.template_id) {
    const template = await loadActiveLesseeTemplate(
      ctx.admin,
      ctx.tenantId,
      trimmed.template_id,
    );
    if (!template.ok) {
      return NextResponse.json(
        { error: template.error },
        { status: template.status },
      );
    }
  }

  const allocated = await allocateLesseeAnnouncementCode(
    ctx.admin,
    ctx.tenantId,
  );
  if (allocated.error || !allocated.code) {
    return NextResponse.json(
      { error: allocated.error ?? "Failed to allocate announcement code." },
      { status: 500 },
    );
  }

  const totalRecipients = await countLesseeAudienceRecipients(
    ctx.admin,
    ctx.tenantId,
    trimmed.audience_filter,
  );

  const { data, error } = await ctx.admin
    .from("lessee_announcements")
    .insert({
      tenant_id: ctx.tenantId,
      announcement_code: allocated.code,
      name: trimmed.name,
      template_id: trimmed.template_id,
      channels: trimmed.channels,
      subject: trimmed.subject,
      body: trimmed.body,
      audience_filter: trimmed.audience_filter,
      status: "draft",
      total_recipients: totalRecipients,
      created_by: ctx.userId,
    })
    .select(LESSEE_ANNOUNCEMENT_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    announcement: normalizeLesseeAnnouncementRow(
      data as unknown as LesseeAnnouncementRow,
    ),
  });
}
