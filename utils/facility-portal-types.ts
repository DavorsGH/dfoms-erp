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

export type FacilityComplaintListRow = {
  complaintId: string;
  leaseId: string;
  lesseeName: string;
  unitLabel: string;
  subject: string;
  description: string;
  status: string;
  statusLabel: string;
  raisedBy: string;
  raisedByLabel: string;
  staffResponse: string | null;
  dateReported: string;
  dateLabel: string;
  isOpen: boolean;
};

export type FacilityInspectionListRow = {
  inspectionId: string;
  leaseId: string;
  lesseeName: string;
  unitLabel: string;
  inspectionType: string;
  inspectionTypeLabel: string;
  inspectionDate: string;
  dateLabel: string;
  conductedBy: string | null;
  notes: string | null;
  checklistItemCount: number;
};

export type FacilityOutstandingLedgerRow = {
  entryId: string;
  leaseId: string;
  propertyId: string;
  lesseeName: string;
  unitLabel: string;
  chargeType: string;
  description: string | null;
  periodStart: string;
  periodEnd: string;
  amountDueGhs: number;
  amountPaidGhs: number;
  outstandingGhs: number;
  status: string;
  statusLabel: string;
  hasPendingCollection: boolean;
};

export type FacilityCollectionListRow = {
  collectionId: string;
  rentLedgerEntryId: string;
  propertyId: string;
  propertyName: string;
  leaseId: string;
  lesseeName: string;
  unitLabel: string;
  amountGhs: number;
  paymentMethod: string;
  paymentMethodLabel: string;
  collectedAt: string;
  collectedAtLabel: string;
  notes: string | null;
  status: string;
  statusLabel: string;
  rejectionReason: string | null;
  ledgerDescription: string | null;
};
