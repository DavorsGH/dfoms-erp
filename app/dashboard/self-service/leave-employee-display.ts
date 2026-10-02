export function formatLeaveEmployeeLabel(
  employeeId: string,
  fullName: string | null | undefined,
): string {
  const trimmed = fullName?.trim();
  if (trimmed && trimmed !== employeeId) {
    return `${trimmed} (${employeeId})`;
  }
  return employeeId;
}

export function buildLeaveEmployeeNameLookup(
  rows: ReadonlyArray<{
    employee_id: string;
    full_name: string | null;
  }>,
): Record<string, string> {
  const lookup: Record<string, string> = {};
  for (const row of rows) {
    const name = row.full_name?.trim();
    if (name) {
      lookup[row.employee_id] = name;
    }
  }
  return lookup;
}
