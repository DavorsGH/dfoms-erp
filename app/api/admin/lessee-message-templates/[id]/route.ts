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

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Template id is required." }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const ctx = await requireLesseeAnnouncementAdmin(readTenantIdFromBody(rawBody));
  if (!ctx.ok) return ctx.response;

  const body = rawBody as LesseeMessageTemplateInput;
  const validationError = validateLesseeMessageTemplateInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimLesseeMessageTemplateInput(body);

  const { data: existing, error: fetchError } = await ctx.admin
    .from("lessee_message_templates")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const { data, error } = await ctx.admin
    .from("lessee_message_templates")
    .update({
      ...trimmed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
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

/** Soft-delete: set is_active=false (templates may be referenced by announcements). */
export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Template id is required." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const ctx = await requireLesseeAnnouncementAdmin(
    readTenantIdFromSearchParams(searchParams),
  );
  if (!ctx.ok) return ctx.response;

  const { data: existing, error: fetchError } = await ctx.admin
    .from("lessee_message_templates")
    .select("id, is_active")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const { data, error } = await ctx.admin
    .from("lessee_message_templates")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
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
