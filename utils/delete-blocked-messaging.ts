/**
 * "1 employee still uses it" vs "N employees still use it"
 */
export function formatEmployeesStillUseItClause(employeeCount: number): string {
  const count = Math.max(0, Math.floor(Number(employeeCount) || 0));
  if (count === 1) {
    return "1 employee still uses it";
  }
  return `${count.toLocaleString()} employees still use it`;
}

export function formatCantDeleteAlertTitle(itemTypeLabel: string): string {
  const label = itemTypeLabel.trim().toLowerCase();
  return label ? `Can't delete ${label}` : "Can't delete item";
}
