import { NextResponse } from "next/server";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { LANDLORD_PORTAL_INACTIVE_SIGNATURE_MESSAGE } from "@/utils/landlord-portal-access-messages";
import { createAdminClient } from "@/utils/supabase/admin";

type SignatureDetailsBody = {
  signature_author_name?: string | null;
  signature_author_title?: string | null;
};

/**
 * platform_only landlord: save printed name/title for Real Estate PDF signature blocks.
 */
export async function POST(request: Request) {
  const session = await getLandlordPortalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!landlordPortalHasDataAccess(session)) {
    return NextResponse.json(
      {
        error: LANDLORD_PORTAL_INACTIVE_SIGNATURE_MESSAGE,
      },
      { status: 403 },
    );
  }
  if (session.landlordType !== "platform_only") {
    return NextResponse.json(
      {
        error:
          "Signature settings are only available for platform-managed landlord accounts.",
      },
      { status: 403 },
    );
  }

  let body: SignatureDetailsBody;
  try {
    body = (await request.json()) as SignatureDetailsBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const signatureAuthorName =
    typeof body.signature_author_name === "string"
      ? body.signature_author_name.trim() || null
      : null;
  const signatureAuthorTitle =
    typeof body.signature_author_title === "string"
      ? body.signature_author_title.trim() || null
      : null;

  const admin = createAdminClient();
  const { error } = await admin
    .from("landlords")
    .update({
      signature_author_name: signatureAuthorName,
      signature_author_title: signatureAuthorTitle,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", session.tenantId)
    .eq("landlord_type", "platform_only");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    signature_author_name: signatureAuthorName,
    signature_author_title: signatureAuthorTitle,
  });
}
