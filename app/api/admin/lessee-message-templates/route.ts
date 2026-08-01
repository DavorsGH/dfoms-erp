import { NextResponse } from "next/server";
import {
  readTenantIdFromBody,
  readTenantIdFromSearchParams,
  requireLesseeAnnouncementAdmin,
} from "@/utils/lessee-announcements-admin";
import {
  LESSEE_MESSAGE_TEMPLATE_SELECT,
  normalizeLesseeMessageTemplateRow,
  trimLesseeMessageTemplateInput,
  validateLesseeMessageTemplateInput,
  type LesseeMessageTemplateInput,
  type LesseeMessageTemplateRow,
} from "@/utils/lessee-message-templates-types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ctx = await requireLesseeAnnouncementAdmin(
    readTenantIdFromSearchParams(searchParams),
  );
  if (!ctx.ok) return ctx.response;

  const channelFilter = searchParams.get("channel")?.trim() ?? "";
  const includeInactive = searchParams.get("include_inactive") === "1";

  let query = ctx.admin
    .from("lessee_message_templates")
    .select(LESSEE_MESSAGE_TEMPLATE_SELECT)
    .eq("tenant_id", ctx.tenantId)
    .order("updated_at", { ascending: false });

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }
  if (channelFilter) {
    query = query.eq("channel", channelFilter);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const templates = ((data as LesseeMessageTemplateRow[] | null) ?? []).map(
    normalizeLesseeMessageTemplateRow,
  );

  return NextResponse.json({ templates });
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

  const body = rawBody as LesseeMessageTemplateInput & { tenant_id?: string };
  const validationError = validateLesseeMessageTemplateInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimLesseeMessageTemplateInput(body);
  const now = new Date().toISOString();

  const { data, error } = await ctx.admin
    .from("lessee_message_templates")
    .insert({
      tenant_id: ctx.tenantId,
      name: trimmed.name,
      channel: trimmed.channel,
      subject: trimmed.subject,
      body: trimmed.body,
      is_active: trimmed.is_active,
      created_by: ctx.userId,
      created_at: now,
      updated_at: now,
    })
    .select(LESSEE_MESSAGE_TEMPLATE_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    template: normalizeLesseeMessageTemplateRow(
      data as LesseeMessageTemplateRow,
    ),
  });
}
