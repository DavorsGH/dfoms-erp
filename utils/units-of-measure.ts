/** Canonical unit-of-measure values (stored lowercase). */
export const UNITS_OF_MEASURE_PRESETS = [
  "piece",
  "litre",
  "gallon",
  "kg",
  "box",
  "pack",
  "roll",
  "bottle",
  "carton",
  "pair",
  "set",
] as const;

export type UnitOfMeasurePreset = (typeof UNITS_OF_MEASURE_PRESETS)[number];

/** Internal select value for free-text units (not persisted). */
export const UNIT_OF_MEASURE_OTHER = "__other__";

const LEGACY_PIECE_ALIASES = new Set([
  "pcs",
  "psc",
  "pics",
  "pc",
  "pcs.",
  "piece",
  "pieces",
]);

const LITRE_ALIASES = new Set([
  "liter",
  "liters",
  "litre",
  "litres",
  "litter",
  "litters",
]);

const YARD_ALIASES = new Set(["yard", "yards"]);

function normalizeUnitKey(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function isUnitOfMeasurePreset(value: string): value is UnitOfMeasurePreset {
  return (UNITS_OF_MEASURE_PRESETS as readonly string[]).includes(value);
}

/** Gram units (g, gram, …) are shown as stored until a data migration to kg. */
export function isGramUnit(value: string | null | undefined): boolean {
  const key = normalizeUnitKey(value ?? "");
  return key === "g" || key === "gram" || key === "grams" || key === "gm";
}

/** Display label; legacy piece spellings map to "piece" without changing stored data. */
export function formatUnit(value: string | null | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return "";
  }
  if (isUnitOfMeasurePreset(raw)) {
    return raw;
  }
  const key = normalizeUnitKey(raw);
  if (LEGACY_PIECE_ALIASES.has(key)) {
    return "piece";
  }
  if (LITRE_ALIASES.has(key)) {
    return "litre";
  }
  if (YARD_ALIASES.has(key)) {
    return "yard";
  }
  return raw;
}

export function unitOfMeasureFormFromStored(
  storedUnit: string | null | undefined,
): { preset: string; other: string } {
  const unit = storedUnit?.trim() ?? "";
  if (!unit) {
    return { preset: UNITS_OF_MEASURE_PRESETS[0]!, other: "" };
  }
  if (isUnitOfMeasurePreset(unit)) {
    return { preset: unit, other: "" };
  }
  return { preset: UNIT_OF_MEASURE_OTHER, other: unit };
}

export function resolveUnitOfMeasureFromForm(
  unitPreset: string,
  unitOther: string,
): string {
  if (unitPreset === UNIT_OF_MEASURE_OTHER) {
    return unitOther.trim();
  }
  return unitPreset.trim();
}

/** Option label when a stored value is not in the preset list. */
export function unitOfMeasureOtherOptionLabel(storedValue: string): string {
  const trimmed = storedValue.trim();
  if (!trimmed) {
    return "Other";
  }
  return `Other: ${trimmed}`;
}
