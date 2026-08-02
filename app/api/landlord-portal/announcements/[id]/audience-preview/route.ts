import { NextResponse } from "next/server";
import { previewLesseeAnnouncementAudience } from "@/utils/lessee-announcement-send";
import { requireLesseeAnnouncementLandlordPortal } from "@/utils/lessee-announcements-admin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const ctx = await requireLesseeAnnouncementLandlordPortal();
  if (!ctx.ok) return ctx.response;

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: "Announcement id is required." },
      { status: 400 },
    );
  }

  try {
    const preview = await previewLesseeAnnouncementAudience(ctx.admin, {
      tenantId: ctx.tenantId,
      announcementId: id,
    });
    return NextResponse.json({ preview });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to preview audience.";
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
