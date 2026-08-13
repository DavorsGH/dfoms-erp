import { NextResponse } from "next/server";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { uploadLandlordSignature } from "@/utils/landlord-signature";

/**
 * platform_only landlord: upload authorized signature for Real Estate PDFs.
 */
export async function POST(request: Request) {
  const session = await getLandlordPortalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!landlordPortalHasDataAccess(session)) {
    return NextResponse.json(
      {
        error:
          "Your landlord account is pending approval. Signature upload is unavailable until Davors staff approves your account.",
      },
      { status: 403 },
    );
  }
  if (session.landlordType !== "platform_only") {
    return NextResponse.json(
      {
        error:
          "Signature upload is only available for platform-managed landlord accounts.",
      },
      { status: 403 },
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

  const admin = createAdminClient();
  const tenantId = session.tenantId;

  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id, landlord_type")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (landlordError) {
    return NextResponse.json({ error: landlordError.message }, { status: 400 });
  }
  if (!landlord) {
    return NextResponse.json({ error: "Landlord not found." }, { status: 404 });
  }
  if (landlord.landlord_type !== "platform_only") {
    return NextResponse.json(
      { error: "Signature upload is only available for platform-managed landlords." },
      { status: 403 },
    );
  }

  const uploadResult = await uploadLandlordSignature(admin, tenantId, file);
  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const { error: updateError } = await admin
    .from("landlords")
    .update({
      signature_url: uploadResult.storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    signature_url: uploadResult.storagePath,
  });
}
