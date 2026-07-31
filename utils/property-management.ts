import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import {
  isPropertyType,
  isUnitStatus,
  normalizePhotoUrls,
  type PropertyDetail,
  type PropertyListRow,
  type PropertyRecord,
  type PropertyType,
  type PropertyUnitRecord,
  type UnitStatus,
} from "@/app/dashboard/real-estate/properties-utils";

export type {
  PropertyDetail,
  PropertyListRow,
  PropertyRecord,
  PropertyType,
  PropertyUnitRecord,
  UnitStatus,
} from "@/app/dashboard/real-estate/properties-utils";

type PropertyRow = {
  tenant_id: string;
  property_id: string;
  name: string;
  property_type: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  region: string | null;
  photo_urls: unknown;
  created_at: string;
  updated_at: string;
};

type UnitRow = {
  tenant_id: string;
  unit_id: string;
  property_id: string;
  unit_number: string;
  bedrooms: number | null;
  bathrooms: number | null;
  base_rent_ghs: number | string;
  status: string;
  photo_urls: unknown;
  created_at: string;
  updated_at: string;
};

function mapProperty(row: PropertyRow): PropertyRecord | null {
  if (!isPropertyType(row.property_type)) {
    return null;
  }

  return {
    propertyId: row.property_id,
    tenantId: row.tenant_id,
    name: row.name,
    propertyType: row.property_type,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    region: row.region,
    photoUrls: normalizePhotoUrls(row.photo_urls),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUnit(row: UnitRow): PropertyUnitRecord | null {
  if (!isUnitStatus(row.status)) {
    return null;
  }

  return {
    unitId: row.unit_id,
    tenantId: row.tenant_id,
    propertyId: row.property_id,
    unitNumber: row.unit_number,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    baseRentGhs: Number(row.base_rent_ghs) || 0,
    status: row.status,
    photoUrls: normalizePhotoUrls(row.photo_urls),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Verifies the target is a real-estate landlord tenant (not Davors itself).
 * Caller must already have verified Davors platform access.
 */
export async function assertRealEstateLandlordTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<
  | { ok: true; tenantId: string; name: string }
  | { ok: false; error: string; status: number }
> {
  const trimmed = tenantId.trim();
  if (!trimmed) {
    return { ok: false, error: "tenant_id is required", status: 400 };
  }

  if (trimmed === DAVORS_TENANT_ID) {
    return {
      ok: false,
      error: "The platform tenant cannot be managed as a landlord.",
      status: 400,
    };
  }

  const { data, error } = await admin
    .from("tenants")
    .select("id, name")
    .eq("id", trimmed)
    .eq("product_line", "real_estate_only")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }

  if (!data) {
    return { ok: false, error: "Landlord tenant not found.", status: 404 };
  }

  return {
    ok: true,
    tenantId: data.id as string,
    name: (data.name as string) ?? "Landlord",
  };
}

/**
 * Lists properties for one landlord tenant, with unit counts.
 */
export async function fetchPropertiesForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ rows: PropertyListRow[]; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { rows: [], fetchError: landlord.error };
  }

  const [{ data: properties, error: propertiesError }, { data: units, error: unitsError }] =
    await Promise.all([
      admin
        .from("properties")
        .select(
          "tenant_id, property_id, name, property_type, address_line1, address_line2, city, region, photo_urls, created_at, updated_at",
        )
        .eq("tenant_id", landlord.tenantId)
        .order("created_at", { ascending: false }),
      admin
        .from("property_units")
        .select("property_id")
        .eq("tenant_id", landlord.tenantId),
    ]);

  if (propertiesError) {
    return { rows: [], fetchError: propertiesError.message };
  }
  if (unitsError) {
    return { rows: [], fetchError: unitsError.message };
  }

  const unitCountByProperty = new Map<string, number>();
  for (const row of (units as Array<{ property_id: string }> | null) ?? []) {
    unitCountByProperty.set(
      row.property_id,
      (unitCountByProperty.get(row.property_id) ?? 0) + 1,
    );
  }

  const rows: PropertyListRow[] = [];
  for (const row of (properties as PropertyRow[] | null) ?? []) {
    const mapped = mapProperty(row);
    if (!mapped) {
      continue;
    }
    rows.push({
      propertyId: mapped.propertyId,
      tenantId: mapped.tenantId,
      name: mapped.name,
      propertyType: mapped.propertyType,
      city: mapped.city,
      unitCount: unitCountByProperty.get(mapped.propertyId) ?? 0,
      createdAt: mapped.createdAt,
    });
  }

  return { rows, fetchError: null };
}

/**
 * Loads one property and its units for Davors staff.
 */
export async function fetchPropertyDetail(
  admin: SupabaseClient,
  tenantId: string,
  propertyId: string,
): Promise<{ detail: PropertyDetail | null; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { detail: null, fetchError: landlord.error };
  }

  const trimmedPropertyId = propertyId.trim();
  if (!trimmedPropertyId) {
    return { detail: null, fetchError: "property_id is required" };
  }

  const [
    { data: property, error: propertyError },
    { data: units, error: unitsError },
  ] = await Promise.all([
    admin
      .from("properties")
      .select(
        "tenant_id, property_id, name, property_type, address_line1, address_line2, city, region, photo_urls, created_at, updated_at",
      )
      .eq("tenant_id", landlord.tenantId)
      .eq("property_id", trimmedPropertyId)
      .maybeSingle(),
    admin
      .from("property_units")
      .select(
        "tenant_id, unit_id, property_id, unit_number, bedrooms, bathrooms, base_rent_ghs, status, photo_urls, created_at, updated_at",
      )
      .eq("tenant_id", landlord.tenantId)
      .eq("property_id", trimmedPropertyId)
      .order("unit_number", { ascending: true }),
  ]);

  if (propertyError) {
    return { detail: null, fetchError: propertyError.message };
  }
  if (unitsError) {
    return { detail: null, fetchError: unitsError.message };
  }
  if (!property) {
    return { detail: null, fetchError: null };
  }

  const mappedProperty = mapProperty(property as PropertyRow);
  if (!mappedProperty) {
    return { detail: null, fetchError: "Invalid property_type on record." };
  }

  const mappedUnits: PropertyUnitRecord[] = [];
  for (const row of (units as UnitRow[] | null) ?? []) {
    const mapped = mapUnit(row);
    if (mapped) {
      mappedUnits.push(mapped);
    }
  }

  return {
    detail: {
      property: mappedProperty,
      units: mappedUnits,
      landlordName: landlord.name,
    },
    fetchError: null,
  };
}
