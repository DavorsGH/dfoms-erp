import { NextResponse } from "next/server";
import { countLesseeAudienceRecipients } from "@/utils/lessee-announcements-audience";
import {
  loadActiveLesseeTemplate,
  requireLesseeAnnouncementLandlordPortal,
} from "@/utils/lessee-announcements-admin";
import {
  LESSEE_ANNOUNCEMENT_SELECT,
  isDraftStatus,
  normalizeLesseeAnnouncementRow,
  trimLesseeAnnouncementInput,
  validateLesseeAnnouncementInput,
  type LesseeAnnouncementInput,
  type LesseeAnnouncementRow,
} from "@/utils/lessee-announcements-types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const ctx = await requireLesseeAnnouncementLandlordPortal();
  if (!ctx.ok) return ctx.response;

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

  const body = rawBody as LesseeAnnouncementInput;
  const validationError = validateLesseeAnnouncementInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimLesseeAnnouncementInput(body);

  const { data: existing, error: fetchError } = await ctx.admin
    .from("lessee_announcements")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
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

  const totalRecipients = await countLesseeAudienceRecipients(
    ctx.admin,
    ctx.tenantId,
    trimmed.audience_filter,
  );

  const { data, error } = await ctx.admin
    .from("lessee_announcements")
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
    .eq("tenant_id", ctx.tenantId)
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

export async function DELETE(request: Request, context: RouteContext) {
  const ctx = await requireLesseeAnnouncementLandlordPortal();
  if (!ctx.ok) return ctx.response;

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: "Announcement id is required." },
      { status: 400 },
    );
  }

  const { data: existing, error: fetchError } = await ctx.admin
    .from("lessee_announcements")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
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

  const { error } = await ctx.admin
    .from("lessee_announcements")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
