export const LOOKUP_SETTINGS_NOTE =
  "Editing a name does not change names stored on past records. Hidden items are kept for history but don't appear when creating new records.";

export const LOOKUP_HIDDEN_LABEL_SUFFIX = " (hidden)";

export function lookupOptionLabel(name: string, isActive: boolean | undefined): string {
  if (isActive === false) {
    return `${name}${LOOKUP_HIDDEN_LABEL_SUFFIX}`;
  }
  return name;
}

export type NamedLookupActive = { name: string; is_active?: boolean };

export function filterActiveNamedLookups<T extends NamedLookupActive>(
  rows: T[],
): Array<{ name: string }> {
  return rows.filter((row) => row.is_active !== false).map((row) => ({ name: row.name }));
}

export function namedLookupSelectOptionsForCreate(
  rows: NamedLookupActive[],
  isEditing: boolean,
  currentValue: string,
): NamedLookupActive[] {
  const currentKey = currentValue.trim().toLowerCase();
  return rows.filter((row) => {
    if (row.is_active === false) {
      return isEditing && row.name.trim().toLowerCase() === currentKey;
    }
    return true;
  });
}

export function expenseCategoryNameTaken(
  rows: Array<{ name: string }>,
  candidate: string,
  exceptName?: string,
): boolean {
  const key = candidate.trim().toLowerCase();
  const exceptKey = (exceptName ?? "").trim().toLowerCase();
  if (!key) {
    return false;
  }
  return rows.some((row) => {
    const rowKey = row.name.trim().toLowerCase();
    return rowKey === key && rowKey !== exceptKey;
  });
}
