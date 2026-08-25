import { NextResponse } from "next/server";
import { requireApprovedLandlordSession } from "@/utils/landlord-portal-auth";
import {
  assertPropertiesBelongToTenant,
  DEFAULT_FACILITY_MANAGER_CAPABILITIES,
  rejectDavorsManagedFacilityManagerCollectionCapabilities,
  type FacilityManagerCapabilityFlags,
} from "@/utils/facility-manager-portal-invite";

export const runtime = "nodejs";

type PatchBody = {
  full_name?: string;
  phone?: string | null;
  property_ids?: string[];
  can_manage_maintenance?: boolean;
  can_manage_complaints?: boolean;
  can_manage_inspections?: boolean;
  can_log_services?: boolean;
  can_collect_rent?: boolean;
  can_collect_charges?: boolean;
};

function pickCapabilityUpdates(
  body: PatchBody,
): Partial<FacilityManagerCapabilityFlags> {
  const updates: Partial<FacilityManagerCapabilityFlags> = {};
  for (const key of Object.keys(
    DEFAULT_FACILITY_MANAGER_CAPABILITIES,
  ) as Array<keyof FacilityManagerCapabilityFlags>) {
    if (typeof body[key] === "boolean") {
      updates[key] = body[key] as boolean;
    }
  }
  return updates;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApprovedLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { id: facilityManagerId } = await context.params;
  if (!facilityManagerId?.trim()) {
    return NextResponse.json(
      { error: "facility manager id is required" },
      { status: 400 },
    );
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { data: existing, error: loadError } = await auth.admin
    .from("facility_managers")
    .select("facility_manager_id, status")
    .eq("tenant_id", auth.session.tenantId)
    .eq("facility_manager_id", facilityManagerId)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Facility manager not found." },
      { status: 404 },
    );
  }
  if (existing.status === "revoked") {
    return NextResponse.json(
      { error: "Cannot update a revoked facility manager." },
      { status: 400 },
    );
  }

  const capabilityUpdates = pickCapabilityUpdates(body);
  const collectionCapabilityError =
    rejectDavorsManagedFacilityManagerCollectionCapabilities({
      landlordType: auth.session.landlordType,
      canCollectRent:
        typeof body.can_collect_rent === "boolean" && body.can_collect_rent,
      canCollectCharges:
        typeof body.can_collect_charges === "boolean" && body.can_collect_charges,
    });
  if (collectionCapabilityError) {
    return NextResponse.json({ error: collectionCapabilityError }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: nowIso };

  if (typeof body.full_name === "string" && body.full_name.trim()) {
    updates.full_name = body.full_name.trim();
  }
  if (body.phone !== undefined) {
    updates.phone =
      typeof body.phone === "string" && body.phone.trim()
        ? body.phone.trim()
        : null;
  }
  Object.assign(updates, capabilityUpdates);

  if (Object.keys(updates).length > 1) {
    const { error: updateError } = await auth.admin
      .from("facility_managers")
      .update(updates)
      .eq("tenant_id", auth.session.tenantId)
      .eq("facility_manager_id", facilityManagerId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }
  }

  if (Array.isArray(body.property_ids)) {
    const propertyIds = body.property_ids.filter(
      (id): id is string => typeof id === "string",
    );
    const propertyCheck = await assertPropertiesBelongToTenant(auth.admin, {
      tenantId: auth.session.tenantId,
      propertyIds,
    });
    if (!propertyCheck.ok) {
      return NextResponse.json({ error: propertyCheck.error }, { status: 400 });
    }

    const uniquePropertyIds = [...new Set(propertyIds.map((id) => id.trim()))];

    const { error: deleteError } = await auth.admin
      .from("facility_manager_property_assignments")
      .delete()
      .eq("tenant_id", auth.session.tenantId)
      .eq("facility_manager_id", facilityManagerId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    if (uniquePropertyIds.length > 0) {
      const { error: insertError } = await auth.admin
        .from("facility_manager_property_assignments")
        .insert(
          uniquePropertyIds.map((propertyId) => ({
            tenant_id: auth.session.tenantId,
            facility_manager_id: facilityManagerId,
            property_id: propertyId,
            created_by_auth_uid: auth.session.authUserId,
            created_at: nowIso,
          })),
        );

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
