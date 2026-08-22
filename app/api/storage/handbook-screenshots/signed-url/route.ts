import { NextResponse } from "next/server";
import { getCurrentAuthUser } from "@/utils/dashboard-auth";
import { getLandlordPortalSession } from "@/utils/landlord-portal-auth";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import {
  createHandbookScreenshotSignedUrl,
  extractHandbookScreenshotStoragePath,
  HANDBOOK_SCREENSHOTS_SIGNED_URL_TTL_SECONDS,
} from "@/utils/handbook-screenshots-storage";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

/**
 * Issue a short-lived signed URL for a handbook-screenshots object.
 * Platform-wide handbook UI assets — any authenticated portal user may read.
 */
export async function GET(request: Request) {
  const reference = new URL(request.url).searchParams.get("reference")?.trim() ?? "";

  if (!reference) {
    return NextResponse.json({ error: "reference is required." }, { status: 400 });
  }

  const storagePath = extractHandbookScreenshotStoragePath(reference);
  if (!storagePath) {
    return NextResponse.json(
      { error: "Not a handbook-screenshots storage reference." },
      { status: 400 },
    );
  }

  const [user, portalSession, landlordSession] = await Promise.all([
    getCurrentAuthUser(),
    getPortalLesseeSession(),
    getLandlordPortalSession(),
  ]);

  if (!user && !portalSession && !landlordSession) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const signedUrl = await createHandbookScreenshotSignedUrl(admin, storagePath);

  if (!signedUrl) {
    return NextResponse.json(
      { error: "Failed to create signed URL." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    signedUrl,
    expiresIn: HANDBOOK_SCREENSHOTS_SIGNED_URL_TTL_SECONDS,
  });
}
