import { NextResponse } from "next/server";
import { requireFacilityManagerSession } from "@/utils/facility-portal-auth";
import { assertFacilityRentLedgerEntryOnAssignedProperty } from "@/utils/facility-portal-data";

const PAYMENT_METHODS = new Set(["cash", "momo", "bank_transfer"]);

type CreateBody = {
  rent_ledger_entry_id?: string;
  amount_ghs?: number | string;
  payment_method?: string;
  notes?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireFacilityManagerSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { session, admin } = auth;
  if (!session.canCollectRent && !session.canCollectCharges) {
    return NextResponse.json(
      { error: "You do not have permission to record collections." },
      { status: 403 },
    );
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const entryId = body.rent_ledger_entry_id?.trim() ?? "";
  const paymentMethod = body.payment_method?.trim() ?? "";
  const notes = body.notes?.trim() || null;

  if (!entryId) {
    return NextResponse.json(
      { error: "rent_ledger_entry_id is required" },
      { status: 400 },
    );
  }
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    return NextResponse.json(
      { error: "payment_method must be cash, momo, or bank_transfer." },
      { status: 400 },
    );
  }

  const amount = Number(body.amount_ghs);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount_ghs must be a positive number." },
      { status: 400 },
    );
  }

  const entryCheck = await assertFacilityRentLedgerEntryOnAssignedProperty(
    admin,
    session,
    entryId,
  );
  if (!entryCheck.ok) {
    return NextResponse.json(
      { error: entryCheck.error },
      { status: entryCheck.status },
    );
  }

  if (amount > entryCheck.outstandingGhs + 0.01) {
    return NextResponse.json(
      {
        error: `Amount cannot exceed outstanding balance (GHS ${entryCheck.outstandingGhs.toFixed(2)}).`,
      },
      { status: 400 },
    );
  }

  const { data: existingPending } = await admin
    .from("facility_manager_collections")
    .select("collection_id")
    .eq("tenant_id", session.tenantId)
    .eq("rent_ledger_entry_id", entryId)
    .eq("status", "pending_landlord_confirmation")
    .maybeSingle();

  if (existingPending) {
    return NextResponse.json(
      {
        error:
          "A collection for this ledger entry is already pending landlord confirmation.",
      },
      { status: 400 },
    );
  }

  const collectionId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const { error: insertError } = await admin
    .from("facility_manager_collections")
    .insert({
      collection_id: collectionId,
      tenant_id: session.tenantId,
      facility_manager_id: session.facilityManagerId,
      rent_ledger_entry_id: entryId,
      property_id: entryCheck.propertyId,
      lease_id: entryCheck.leaseId,
      amount_ghs: amount,
      payment_method: paymentMethod,
      collected_at: nowIso,
      notes,
      status: "pending_landlord_confirmation",
      created_at: nowIso,
    });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    collection_id: collectionId,
    status: "pending_landlord_confirmation",
  });
}
