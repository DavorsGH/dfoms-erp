export type PropertyType = "residential" | "commercial" | "mixed_use";

export type UnitStatus = "vacant" | "occupied" | "under_maintenance";

export type PropertyListRow = {
  propertyId: string;
  tenantId: string;
  name: string;
  propertyType: PropertyType;
  city: string;
  unitCount: number;
  occupancyStatus: PropertyOccupancyStatus;
  createdAt: string;
};

export type PropertyOccupancyStatus =
  | "No Units"
  | "Vacant"
  | "Fully Occupied"
  | "Partially Occupied";

export function computePropertyOccupancyStatus(
  unitStatuses: Array<string | null | undefined>,
): PropertyOccupancyStatus {
  if (unitStatuses.length === 0) {
    return "No Units";
  }

  const allVacant = unitStatuses.every((status) => status === "vacant");
  if (allVacant) {
    return "Vacant";
  }

  const allOccupied = unitStatuses.every((status) => status === "occupied");
  if (allOccupied) {
    return "Fully Occupied";
  }

  return "Partially Occupied";
}

export type PropertyRecord = {
  propertyId: string;
  tenantId: string;
  name: string;
  propertyType: PropertyType;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  photoUrls: string[];
  createdAt: string;
  updatedAt: string;
};

export type PropertyUnitRecord = {
  unitId: string;
  tenantId: string;
  propertyId: string;
  unitNumber: string;
  bedrooms: number | null;
  bathrooms: number | null;
  baseRentGhs: number;
  status: UnitStatus;
  photoUrls: string[];
  createdAt: string;
  updatedAt: string;
};

export type PropertyDetail = {
  property: PropertyRecord;
  units: PropertyUnitRecord[];
  landlordName: string;
};

export const PROPERTY_TYPE_OPTIONS: Array<{
  value: PropertyType;
  label: string;
}> = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "mixed_use", label: "Mixed Use" },
];

export const UNIT_STATUS_OPTIONS: Array<{
  value: UnitStatus;
  label: string;
}> = [
  { value: "vacant", label: "Vacant" },
  { value: "occupied", label: "Occupied" },
  { value: "under_maintenance", label: "Under Maintenance" },
];

export function formatPropertyType(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const match = PROPERTY_TYPE_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatUnitStatus(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const match = UNIT_STATUS_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatPropertyDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatPropertyRent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function normalizePhotoUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isPropertyType(value: string): value is PropertyType {
  return PROPERTY_TYPE_OPTIONS.some((option) => option.value === value);
}

export function isUnitStatus(value: string): value is UnitStatus {
  return UNIT_STATUS_OPTIONS.some((option) => option.value === value);
}
