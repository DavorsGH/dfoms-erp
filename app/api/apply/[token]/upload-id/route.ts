import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolveRentalApplicationLink } from "@/utils/rental-application-links";
import { uploadPropertyPhoto } from "@/utils/property-photo";

type RouteParams = { params: Promise<{ token: string }> };

/**
 * Public ID document upload for an active apply link.
 * Uploads into tenant-logos under rental_application/{linkId}.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { token } = await params;
  const admin = createAdminClient();
  const resolved = await resolveRentalApplicationLink(admin, token);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status },
    );
  }

  if (resolved.context.unitStatus !== "vacant") {
    return NextResponse.json(
      { error: "This unit is no longer accepting applications." },
      { status: 400 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const uploaded = await uploadPropertyPhoto(
    admin,
    resolved.context.tenantId,
    "rental_application",
    resolved.context.linkId,
    file,
  );

  if ("error" in uploaded) {
    return NextResponse.json({ error: uploaded.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, url: uploaded.storagePath });
}
