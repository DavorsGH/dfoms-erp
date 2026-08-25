/**
 * Shared Facility Portal types (safe for client + server imports).
 */

export type FacilityPropertyOption = {
  propertyId: string;
  name: string;
};

export type FacilityUnitOption = {
  unitId: string;
  propertyId: string;
  label: string;
};

export type FacilityServiceRecordRow = {
  recordId: string;
  propertyId: string;
  propertyName: string;
  unitId: string | null;
  unitLabel: string | null;
  serviceType: string;
  serviceDate: string;
  costGhs: number | null;
  notes: string | null;
};

export type FacilityPortalDashboardSummary = {
  assignedPropertyCount: number;
  propertyNames: string[];
  openMaintenanceCount: number;
  pendingComplaintsCount: number;
  upcomingInspectionsCount: number;
  servicesLoggedThisMonth: number;
  servicesCostThisMonthGhs: number;
  pendingCollectionsCount: number;
};
