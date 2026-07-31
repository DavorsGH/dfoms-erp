export type InspectionType = "move_in" | "move_out";
export type InspectionCondition = "good" | "fair" | "poor" | "damaged";

export type InspectionChecklistItem = {
  name: string;
  condition: InspectionCondition;
  note: string;
};

export type InspectionListRow = {
  inspectionId: string;
  tenantId: string;
  leaseId: string;
  lesseeName: string;
  unitLabel: string;
  inspectionType: InspectionType;
  inspectionDate: string;
  conductedBy: string | null;
  notes: string | null;
  checklist: InspectionChecklistItem[];
  photoUrls: string[];
};

export type InspectionLeaseOption = {
  leaseId: string;
  label: string;
};

export const DEFAULT_INSPECTION_CHECKLIST_NAMES = [
  "Walls & Paint",
  "Flooring",
  "Doors & Locks",
  "Windows",
  "Kitchen Fixtures",
  "Bathroom Fixtures",
  "Electrical & Switches",
  "Plumbing",
  "Ceiling",
  "Overall Cleanliness",
] as const;

export const INSPECTION_TYPE_OPTIONS: Array<{
  value: InspectionType;
  label: string;
}> = [
  { value: "move_in", label: "Move In" },
  { value: "move_out", label: "Move Out" },
];

export const INSPECTION_CONDITION_OPTIONS: Array<{
  value: InspectionCondition;
  label: string;
}> = [
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
  { value: "damaged", label: "Damaged" },
];

export function createDefaultInspectionChecklist(): InspectionChecklistItem[] {
  return DEFAULT_INSPECTION_CHECKLIST_NAMES.map((name) => ({
    name,
    condition: "good",
    note: "",
  }));
}

export function isInspectionType(value: string): value is InspectionType {
  return INSPECTION_TYPE_OPTIONS.some((option) => option.value === value);
}

export function isInspectionCondition(
  value: string,
): value is InspectionCondition {
  return INSPECTION_CONDITION_OPTIONS.some((option) => option.value === value);
}

export function formatInspectionType(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const match = INSPECTION_TYPE_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatInspectionDate(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function normalizeInspectionChecklist(
  value: unknown,
): InspectionChecklistItem[] {
  if (!Array.isArray(value)) {
    return createDefaultInspectionChecklist();
  }

  const items: InspectionChecklistItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name =
      typeof record.name === "string" ? record.name.trim() : "";
    const conditionRaw =
      typeof record.condition === "string" ? record.condition.trim() : "";
    const note =
      typeof record.note === "string" ? record.note.trim() : "";
    if (!name || !isInspectionCondition(conditionRaw)) {
      continue;
    }
    items.push({
      name,
      condition: conditionRaw,
      note,
    });
  }

  return items.length > 0 ? items : createDefaultInspectionChecklist();
}

export function sanitizeInspectionChecklist(
  value: unknown,
): InspectionChecklistItem[] | { error: string } {
  if (!Array.isArray(value)) {
    return { error: "checklist must be an array." };
  }

  const items: InspectionChecklistItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return { error: "Each checklist item must be an object." };
    }
    const record = entry as Record<string, unknown>;
    const name =
      typeof record.name === "string" ? record.name.trim() : "";
    const conditionRaw =
      typeof record.condition === "string" ? record.condition.trim() : "";
    const note =
      typeof record.note === "string" ? record.note.trim() : "";
    if (!name) {
      return { error: "Each checklist item requires a name." };
    }
    if (!isInspectionCondition(conditionRaw)) {
      return {
        error: `Invalid condition for "${name}". Use good, fair, poor, or damaged.`,
      };
    }
    items.push({
      name,
      condition: conditionRaw,
      note,
    });
  }

  return items;
}

export function createBlankInspectionChecklistItem(): InspectionChecklistItem {
  return {
    name: "",
    condition: "good",
    note: "",
  };
}

export { normalizePhotoUrls } from "./properties-utils";
