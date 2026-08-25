import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";

type RejectBody = {
  collection_id?: string;
  rejection_reason?: string | null;
};

export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: RejectBody;
  try {
    body = (await request.json()) as RejectBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const collectionId = body.collection_id?.trim() ?? "";
  if (!collectionId) {
    return NextResponse.json(
      { error: "collection_id is required" },
      { status: 400 },
    );
  }

  const rejectionReason = body.rejection_reason?.trim() || null;
  const { session, admin } = auth;

  const { data: collection, error: loadError } = await admin
    .from("facility_manager_collections")
    .select("collection_id, status")
    .eq("tenant_id", session.tenantId)
    .eq("collection_id", collectionId)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 400 });
  }
  if (!collection) {
    return NextResponse.json(
      { error: "Collection not found." },
      { status: 404 },
    );
  }
  if (collection.status !== "pending_landlord_confirmation") {
    return NextResponse.json(
      { error: "This collection is not pending confirmation." },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await admin
    .from("facility_manager_collections")
    .update({
      status: "rejected",
      confirmed_by_auth_uid: session.authUserId,
      confirmed_at: nowIso,
      rejection_reason: rejectionReason,
    })
    .eq("tenant_id", session.tenantId)
    .eq("collection_id", collectionId)
    .eq("status", "pending_landlord_confirmation");

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, status: "rejected" });
}
