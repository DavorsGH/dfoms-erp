export type LandlordType = "platform_only" | "davors_managed";
export type LandlordApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "suspended";
export type LandlordSubscriptionTier = "base" | "growth" | "pro";
export type LandlordSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled";

export type LandlordListRow = {
  tenantId: string;
  name: string;
  landlordType: LandlordType | null;
  approvalStatus: LandlordApprovalStatus | null;
  authUserId: string | null;
  subscriptionTier: LandlordSubscriptionTier | null;
  createdAt: string;
};

/** Staff pickers on Properties/Tenants/Leases/etc. — not the Landlords admin list. */
export function filterDavorsManagedLandlords(
  rows: LandlordListRow[],
): LandlordListRow[] {
  return rows.filter((row) => row.landlordType === "davors_managed");
}

export type LandlordSubscriptionDetails = {
  tier: LandlordSubscriptionTier | null;
  status: LandlordSubscriptionStatus | null;
  trialEndsAt: string | null;
  activeUnitCount: number | null;
  currentPeriodPriceGhs: number | null;
  includedUnits: number | null;
  extraUnitPriceGhs: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  basePriceGhs: number | null;
};

export type LandlordDetail = {
  tenantId: string;
  name: string;
  slug: string | null;
  status: string | null;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  tenantCode: string | null;
  productLine: string | null;
  landlordType: LandlordType | null;
  approvalStatus: LandlordApprovalStatus | null;
  authUserId: string | null;
  managementFeePercent: number | null;
  paystackSubaccountCode: string | null;
  /** SMS recipient for platform_only Real Estate ops alerts. */
  notificationPhone: string | null;
  smsCreditBalance: number | null;
  landlordCreatedAt: string | null;
  landlordUpdatedAt: string | null;
  subscription: LandlordSubscriptionDetails | null;
};

export const LANDLORD_TYPE_OPTIONS: Array<{
  value: LandlordType;
  label: string;
}> = [
  { value: "platform_only", label: "Platform Only" },
  { value: "davors_managed", label: "Davors Managed" },
];

export const LANDLORD_APPROVAL_STATUS_OPTIONS: Array<{
  value: LandlordApprovalStatus;
  label: string;
}> = [
  { value: "pending", label: "Pending (legacy)" },
  { value: "approved", label: "Approved" },
  { value: "suspended", label: "Suspended" },
  { value: "rejected", label: "Rejected (legacy)" },
];

export function formatLandlordType(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const match = LANDLORD_TYPE_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatLandlordApprovalStatus(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const match = LANDLORD_APPROVAL_STATUS_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatLandlordTier(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatLandlordDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Staff list Portal column — derived from approval_status + auth link. */
export function formatLandlordPortalStatus(row: {
  approvalStatus: LandlordApprovalStatus | null;
  authUserId: string | null;
}): string {
  if (row.approvalStatus === "approved") {
    return row.authUserId ? "Active" : "Approved · invite pending";
  }
  if (row.approvalStatus === "suspended") {
    return "Suspended";
  }
  if (row.approvalStatus === "pending") {
    return "Setup incomplete (legacy)";
  }
  if (row.approvalStatus === "rejected") {
    return "Not approved (legacy)";
  }
  return "—";
}
