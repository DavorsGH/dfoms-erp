import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { fetchLandlordTypeForTenant } from "@/utils/rent-ledger-management";
import { applyRentLedgerPayment } from "@/utils/rent-ledger-apply-payment";

type ConfirmBody = {
  collection_id?: string;
};

export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: ConfirmBody;
  try {
    body = (await request.json()) as ConfirmBody;
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

  const { session, admin } = auth;

  const { data: collection, error: loadError } = await admin
    .from("facility_manager_collections")
    .select(
      "collection_id, rent_ledger_entry_id, amount_ghs, payment_method, collected_at, notes, status, applied_to_rent_ledger_at",
    )
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
  if (collection.applied_to_rent_ledger_at) {
    return NextResponse.json(
      { error: "This collection was already applied to the ledger." },
      { status: 400 },
    );
  }

  const { landlordType, fetchError: landlordTypeError } =
    await fetchLandlordTypeForTenant(admin, session.tenantId);
  if (landlordTypeError || !landlordType) {
    return NextResponse.json(
      { error: landlordTypeError ?? "Landlord type not configured." },
      { status: 400 },
    );
  }

  const collectedAt = String(collection.collected_at ?? "");
  const paymentDate = collectedAt.slice(0, 10);
  const fmNotes = collection.notes ? String(collection.notes) : null;

  const paymentResult = await applyRentLedgerPayment(admin, {
    tenantId: session.tenantId,
    entryId: collection.rent_ledger_entry_id as string,
    paymentAmountGhs: Number(collection.amount_ghs),
    paymentMethod: String(collection.payment_method),
    paymentDate: /^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
      ? paymentDate
      : new Date().toISOString().slice(0, 10),
    notes: fmNotes,
    landlordType,
    notePrefix: "FM collection",
  });

  if (!paymentResult.ok) {
    return NextResponse.json(
      { error: paymentResult.error },
      { status: paymentResult.status },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await admin
    .from("facility_manager_collections")
    .update({
      status: "confirmed",
      confirmed_by_auth_uid: session.authUserId,
      confirmed_at: nowIso,
      applied_to_rent_ledger_at: nowIso,
    })
    .eq("tenant_id", session.tenantId)
    .eq("collection_id", collectionId)
    .eq("status", "pending_landlord_confirmation");

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    amount_paid_ghs: paymentResult.amountPaidGhs,
    ledger_status: paymentResult.status,
  });
}
