import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeAudienceFilter,
  type LesseeAnnouncementAudienceFilter,
} from "@/utils/lessee-announcements-types";

export const ANNOUNCEMENT_LESSEE_SELECT =
  "lessee_id, full_name, email, phone, status, auth_user_id" as const;

export type AnnouncementLessee = {
  lessee_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string | null;
  auth_user_id: string | null;
  /** Best-effort context from an active lease (for template variables). */
  property_name?: string | null;
  unit_number?: string | null;
  lease_id?: string | null;
};

function applyActiveLesseeFilter<T extends { eq: (col: string, val: string) => T }>(
  query: T,
): T {
  return query.eq("status", "active");
}

function mergeLessees(
  into: Map<string, AnnouncementLessee>,
  rows: AnnouncementLessee[],
) {
  for (const row of rows) {
    const existing = into.get(row.lessee_id);
    if (!existing) {
      into.set(row.lessee_id, row);
      continue;
    }
    // Prefer row that carries lease/property context.
    if (!existing.property_name && row.property_name) {
      into.set(row.lessee_id, { ...existing, ...row });
    }
  }
}

function coerceAudience(
  audience: LesseeAnnouncementAudienceFilter | unknown,
): LesseeAnnouncementAudienceFilter {
  return (
    normalizeAudienceFilter(audience) ??
    (audience as LesseeAnnouncementAudienceFilter)
  );
}

async function fetchActiveLesseesByIds(
  supabase: SupabaseClient,
  tenantId: string,
  lesseeIds: string[],
): Promise<AnnouncementLessee[]> {
  if (lesseeIds.length === 0) return [];

  let query = supabase
    .from("lessees")
    .select(ANNOUNCEMENT_LESSEE_SELECT)
    .eq("tenant_id", tenantId)
    .in("lessee_id", lesseeIds);

  query = applyActiveLesseeFilter(query);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data as AnnouncementLessee[] | null) ?? []).map((row) => ({
    ...row,
    email: row.email ?? null,
    phone: row.phone ?? null,
    auth_user_id: row.auth_user_id ?? null,
  }));
}

async function fetchLesseesByLeaseIds(
  supabase: SupabaseClient,
  tenantId: string,
  leaseIds: string[],
): Promise<AnnouncementLessee[]> {
  if (leaseIds.length === 0) return [];

  const { data: leases, error: leasesError } = await supabase
    .from("leases")
    .select("lease_id, lessee_id, unit_id, status")
    .eq("tenant_id", tenantId)
    .in("lease_id", leaseIds);

  if (leasesError) throw new Error(leasesError.message);
  const leaseRows = leases ?? [];
  if (leaseRows.length === 0) return [];

  const lesseeIds = [...new Set(leaseRows.map((r) => r.lessee_id).filter(Boolean))];
  const lessees = await fetchActiveLesseesByIds(supabase, tenantId, lesseeIds);
  const byId = new Map(lessees.map((l) => [l.lessee_id, l]));

  const unitIds = [
    ...new Set(leaseRows.map((r) => r.unit_id).filter(Boolean) as string[]),
  ];
  const unitById = new Map<
    string,
    { unit_number: string; property_id: string }
  >();
  const propertyById = new Map<string, string>();

  if (unitIds.length > 0) {
    const { data: units, error: unitsError } = await supabase
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", tenantId)
      .in("unit_id", unitIds);
    if (unitsError) throw new Error(unitsError.message);
    for (const unit of units ?? []) {
      unitById.set(unit.unit_id, {
        unit_number: unit.unit_number,
        property_id: unit.property_id,
      });
    }
    const propertyIds = [
      ...new Set(
        (units ?? []).map((u) => u.property_id).filter(Boolean) as string[],
      ),
    ];
    if (propertyIds.length > 0) {
      const { data: properties, error: propertiesError } = await supabase
        .from("properties")
        .select("property_id, name")
        .eq("tenant_id", tenantId)
        .in("property_id", propertyIds);
      if (propertiesError) throw new Error(propertiesError.message);
      for (const property of properties ?? []) {
        propertyById.set(property.property_id, property.name);
      }
    }
  }

  const result: AnnouncementLessee[] = [];
  for (const lease of leaseRows) {
    const lessee = byId.get(lease.lessee_id);
    if (!lessee) continue;
    const unit = lease.unit_id ? unitById.get(lease.unit_id) : null;
    result.push({
      ...lessee,
      lease_id: lease.lease_id,
      unit_number: unit?.unit_number ?? null,
      property_name: unit
        ? (propertyById.get(unit.property_id) ?? null)
        : null,
    });
  }
  return result;
}

async function fetchLesseesByPropertyIds(
  supabase: SupabaseClient,
  tenantId: string,
  propertyIds: string[],
): Promise<AnnouncementLessee[]> {
  if (propertyIds.length === 0) return [];

  const { data: units, error: unitsError } = await supabase
    .from("property_units")
    .select("unit_id, unit_number, property_id")
    .eq("tenant_id", tenantId)
    .in("property_id", propertyIds);

  if (unitsError) throw new Error(unitsError.message);
  const unitRows = units ?? [];
  if (unitRows.length === 0) return [];

  const unitIds = unitRows.map((u) => u.unit_id);
  const unitById = new Map(
    unitRows.map((u) => [
      u.unit_id,
      { unit_number: u.unit_number, property_id: u.property_id },
    ]),
  );

  const { data: properties, error: propertiesError } = await supabase
    .from("properties")
    .select("property_id, name")
    .eq("tenant_id", tenantId)
    .in("property_id", propertyIds);
  if (propertiesError) throw new Error(propertiesError.message);
  const propertyById = new Map(
    (properties ?? []).map((p) => [p.property_id, p.name]),
  );

  const { data: leases, error: leasesError } = await supabase
    .from("leases")
    .select("lease_id, lessee_id, unit_id, status")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("unit_id", unitIds);

  if (leasesError) throw new Error(leasesError.message);
  const leaseRows = leases ?? [];
  if (leaseRows.length === 0) return [];

  const lesseeIds = [...new Set(leaseRows.map((r) => r.lessee_id))];
  const lessees = await fetchActiveLesseesByIds(supabase, tenantId, lesseeIds);
  const byId = new Map(lessees.map((l) => [l.lessee_id, l]));

  const result: AnnouncementLessee[] = [];
  for (const lease of leaseRows) {
    const lessee = byId.get(lease.lessee_id);
    if (!lessee) continue;
    const unit = lease.unit_id ? unitById.get(lease.unit_id) : null;
    result.push({
      ...lessee,
      lease_id: lease.lease_id,
      unit_number: unit?.unit_number ?? null,
      property_name: unit
        ? (propertyById.get(unit.property_id) ?? null)
        : null,
    });
  }
  return result;
}

async function attachPrimaryLeaseContext(
  supabase: SupabaseClient,
  tenantId: string,
  lessees: AnnouncementLessee[],
): Promise<AnnouncementLessee[]> {
  if (lessees.length === 0) return lessees;
  const needingContext = lessees.filter((l) => !l.property_name);
  if (needingContext.length === 0) return lessees;

  const lesseeIds = needingContext.map((l) => l.lessee_id);
  const { data: leases, error } = await supabase
    .from("leases")
    .select("lease_id, lessee_id, unit_id, status")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("lessee_id", lesseeIds)
    .order("created_at", { ascending: false });

  if (error || !leases?.length) return lessees;

  const firstLeaseByLessee = new Map<string, (typeof leases)[number]>();
  for (const lease of leases) {
    if (!firstLeaseByLessee.has(lease.lessee_id)) {
      firstLeaseByLessee.set(lease.lessee_id, lease);
    }
  }

  const unitIds = [
    ...new Set(
      [...firstLeaseByLessee.values()]
        .map((l) => l.unit_id)
        .filter(Boolean) as string[],
    ),
  ];
  if (unitIds.length === 0) return lessees;

  const { data: units } = await supabase
    .from("property_units")
    .select("unit_id, unit_number, property_id")
    .eq("tenant_id", tenantId)
    .in("unit_id", unitIds);
  const unitById = new Map(
    (units ?? []).map((u) => [
      u.unit_id,
      { unit_number: u.unit_number, property_id: u.property_id },
    ]),
  );
  const propertyIds = [
    ...new Set((units ?? []).map((u) => u.property_id).filter(Boolean)),
  ];
  const { data: properties } = await supabase
    .from("properties")
    .select("property_id, name")
    .eq("tenant_id", tenantId)
    .in("property_id", propertyIds);
  const propertyById = new Map(
    (properties ?? []).map((p) => [p.property_id, p.name]),
  );

  return lessees.map((lessee) => {
    if (lessee.property_name) return lessee;
    const lease = firstLeaseByLessee.get(lessee.lessee_id);
    if (!lease?.unit_id) return lessee;
    const unit = unitById.get(lease.unit_id);
    if (!unit) return lessee;
    return {
      ...lessee,
      lease_id: lease.lease_id,
      unit_number: unit.unit_number,
      property_name: propertyById.get(unit.property_id) ?? null,
    };
  });
}

/**
 * Resolve audience lessees.
 * `filtered` = OR-union of property_ids ∪ lease_ids ∪ lessee_ids,
 * de-duplicated by lessee_id. Active lessees only.
 */
export async function loadAnnouncementLessees(
  supabase: SupabaseClient,
  tenantId: string,
  audienceInput: LesseeAnnouncementAudienceFilter | unknown,
): Promise<AnnouncementLessee[]> {
  const audience = coerceAudience(audienceInput);

  if (audience.type === "all") {
    let query = supabase
      .from("lessees")
      .select(ANNOUNCEMENT_LESSEE_SELECT)
      .eq("tenant_id", tenantId)
      .order("full_name", { ascending: true });
    query = applyActiveLesseeFilter(query);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = ((data as AnnouncementLessee[] | null) ?? []).map((row) => ({
      ...row,
      email: row.email ?? null,
      phone: row.phone ?? null,
      auth_user_id: row.auth_user_id ?? null,
    }));
    return attachPrimaryLeaseContext(supabase, tenantId, rows);
  }

  if (audience.type !== "filtered") {
    return [];
  }

  const byId = new Map<string, AnnouncementLessee>();

  const [byProperty, byLease, byIndividual] = await Promise.all([
    fetchLesseesByPropertyIds(supabase, tenantId, audience.property_ids),
    fetchLesseesByLeaseIds(supabase, tenantId, audience.lease_ids),
    fetchActiveLesseesByIds(supabase, tenantId, audience.lessee_ids),
  ]);

  mergeLessees(byId, byProperty);
  mergeLessees(byId, byLease);
  mergeLessees(byId, byIndividual);

  const merged = [...byId.values()].sort((a, b) =>
    a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" }),
  );
  return attachPrimaryLeaseContext(supabase, tenantId, merged);
}

export async function countLesseeAudienceRecipients(
  supabase: SupabaseClient,
  tenantId: string,
  audienceInput: LesseeAnnouncementAudienceFilter | unknown,
): Promise<number> {
  const audience = coerceAudience(audienceInput);

  if (audience.type === "all") {
    let query = supabase
      .from("lessees")
      .select("lessee_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    query = applyActiveLesseeFilter(query);
    const { count, error } = await query;
    if (error) {
      console.error(
        "[lessee-announcements] audience count failed:",
        error.message,
      );
      return 0;
    }
    return count ?? 0;
  }

  try {
    const lessees = await loadAnnouncementLessees(
      supabase,
      tenantId,
      audience,
    );
    return lessees.length;
  } catch (error) {
    console.error(
      "[lessee-announcements] audience count failed:",
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}
