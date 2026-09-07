/**
 * Resolve a concrete business_unit_id when the switcher would otherwise use
 * workspace-default (null). Client-safe — no server imports.
 */

export type BusinessUnitNameRow = {
  id: string;
  name: string;
};

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Match tenant workspace name to an active business unit (exact, then substring).
 */
export function matchBusinessUnitForWorkspace(
  units: BusinessUnitNameRow[],
  workspaceName: string,
): string | null {
  const workspace = normalizeLabel(workspaceName);
  if (!workspace || units.length === 0) {
    return null;
  }

  const exact = units.find(
    (unit) => normalizeLabel(unit.name) === workspace,
  );
  if (exact) {
    return exact.id;
  }

  const partial = units.find((unit) => {
    const name = normalizeLabel(unit.name);
    return workspace.includes(name) || name.includes(workspace);
  });
  return partial?.id ?? null;
}

/**
 * Pick the business unit to use when active_business_unit_id is null but the
 * tenant has active units (legacy switcher default / pre-backfill sessions).
 */
export function resolveFallbackBusinessUnitId(
  units: BusinessUnitNameRow[],
  workspaceName?: string | null,
): string | null {
  if (units.length === 0) {
    return null;
  }
  if (units.length === 1) {
    return units[0]!.id;
  }

  const matched = workspaceName
    ? matchBusinessUnitForWorkspace(units, workspaceName)
    : null;
  if (matched) {
    return matched;
  }

  const sorted = [...units].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  return sorted[0]!.id;
}
