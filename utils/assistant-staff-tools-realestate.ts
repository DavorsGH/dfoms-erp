import "server-only";

import {
  buildArrearsAgingReport,
  buildIncomeByPropertyReport,
  buildOccupancyReport,
} from "@/app/dashboard/reports/real-estate-reports-utils";
import {
  fetchArrearsIncomeReportData,
  fetchVacancyOccupancyReportData,
} from "@/app/dashboard/reports/real-estate-report-data";
import { isActiveLeaseStatus } from "@/app/dashboard/real-estate/rent-ledger-utils";
import { isDavorsPlatformRealEstateStaff } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  LIST_LIMIT,
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  parseUpcomingMonths,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";

async function requireRealEstateStaffAccess(): Promise<
  { admin: ReturnType<typeof createAdminClient> } | { error: string }
> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }

  if (!(await isDavorsPlatformRealEstateStaff())) {
    return { error: "You do not have access to Real Estate portfolio data." };
  }

  return { admin: createAdminClient() };
}

export async function getPropertiesOverview(): Promise<unknown> {
  const access = await requireRealEstateStaffAccess();
  if ("error" in access) {
    return access;
  }

  try {
    const data = await fetchVacancyOccupancyReportData(access.admin, {
      kind: "davors_managed",
    });
    if (data.fetchError) {
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: data.fetchError };
    }

    const occupancy = buildOccupancyReport(data.units);
    return {
      landlordCount: data.landlords.length,
      propertyCount: data.properties.length,
      totalUnits: occupancy.totals.total,
      occupiedUnits: occupancy.totals.occupied,
      vacantUnits: occupancy.totals.vacant,
      occupancyRatePct: occupancy.totals.occupancyRatePct,
      byProperty: occupancy.rows.slice(0, LIST_LIMIT),
    };
  } catch (error) {
    console.error("[assistant] get_properties_overview threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getRentCollectionOverview(): Promise<unknown> {
  const access = await requireRealEstateStaffAccess();
  if ("error" in access) {
    return access;
  }

  try {
    const data = await fetchArrearsIncomeReportData(access.admin, {
      kind: "davors_managed",
    });
    if (data.fetchError) {
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: data.fetchError };
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const income = buildIncomeByPropertyReport(data.ledgerRows, year, month);
    const arrears = buildArrearsAgingReport(data.ledgerRows, now);

    return {
      periodLabel: `${year}-${String(month).padStart(2, "0")}`,
      totalDueGhs: income.totals.dueGhs,
      totalCollectedGhs: income.totals.collectedGhs,
      totalOutstandingGhs: income.totals.outstandingGhs,
      collectionRatePct: income.totals.collectionPct,
      overdueTenants: arrears.detailRows.slice(0, LIST_LIMIT).map((row) => ({
        landlordName: row.landlordName,
        propertyName: row.propertyName,
        unitNumber: row.unitNumber,
        tenantName: row.lesseeName,
        outstandingGhs: row.outstandingGhs,
        bucket: row.bucket,
      })),
    };
  } catch (error) {
    console.error("[assistant] get_rent_collection_overview threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getLeaseExpirationsOverview(
  toolInput?: unknown,
): Promise<unknown> {
  const access = await requireRealEstateStaffAccess();
  if ("error" in access) {
    return access;
  }

  const upcomingMonths = parseUpcomingMonths(toolInput);
  const horizon = new Date();
  horizon.setMonth(horizon.getMonth() + upcomingMonths);
  const horizonIso = horizon.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  try {
    const scope = await fetchVacancyOccupancyReportData(access.admin, {
      kind: "davors_managed",
    });
    if (scope.fetchError) {
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: scope.fetchError };
    }

    const tenantIds = scope.landlords.map((row) => row.tenantId);
    if (tenantIds.length === 0) {
      return { upcomingMonths, expirations: [], totalCount: 0 };
    }

    const { data: leases, error } = await access.admin
      .from("leases")
      .select(
        "lease_id, tenant_id, end_date, status, rent_amount_ghs, unit_id, lessee_id, property_units(unit_number, properties(name)), lessees(full_name)",
      )
      .in("tenant_id", tenantIds)
      .gte("end_date", today)
      .lte("end_date", horizonIso)
      .order("end_date", { ascending: true })
      .limit(100);

    if (error) {
      console.error(
        "[assistant] get_lease_expirations_overview failed:",
        error.message,
      );
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const expirations = (leases ?? [])
      .filter((row) => isActiveLeaseStatus(String(row.status)))
      .slice(0, LIST_LIMIT)
      .map((row) => {
        const unit = Array.isArray(row.property_units)
          ? row.property_units[0]
          : row.property_units;
        const property = unit?.properties
          ? Array.isArray(unit.properties)
            ? unit.properties[0]
            : unit.properties
          : null;
        const lessee = Array.isArray(row.lessees) ? row.lessees[0] : row.lessees;
        return {
          endDate: row.end_date,
          monthlyRentGhs: Number(row.rent_amount_ghs) || 0,
          propertyName: property?.name ?? "Property",
          unitNumber: unit?.unit_number ?? "—",
          tenantName: lessee?.full_name ?? "Tenant",
        };
      });

    return { upcomingMonths, totalCount: expirations.length, expirations };
  } catch (error) {
    console.error("[assistant] get_lease_expirations_overview threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
