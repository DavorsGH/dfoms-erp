const SHIFT_PLACEHOLDER_VALUES = new Set([
  "not assigned",
  "unassigned",
  "n/a",
  "na",
  "none",
  "-",
  "--",
  "nil",
]);

export type NormalizedEmployeeImportShift = {
  /** Value used for validation, enum checks, and salary matching (empty when blank or placeholder). */
  effectiveValue: string;
  /** Original trimmed cell text when it was treated as a placeholder blank. */
  placeholderSource: string | null;
};

export function isEmployeeImportShiftPlaceholder(value: unknown): boolean {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return false;
  }

  return SHIFT_PLACEHOLDER_VALUES.has(trimmed.toLowerCase());
}

export function normalizeEmployeeImportShift(value: unknown): NormalizedEmployeeImportShift {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return { effectiveValue: "", placeholderSource: null };
  }

  if (isEmployeeImportShiftPlaceholder(trimmed)) {
    return { effectiveValue: "", placeholderSource: trimmed };
  }

  return { effectiveValue: trimmed, placeholderSource: null };
}
