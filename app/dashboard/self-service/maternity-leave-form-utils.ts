export const MATERNITY_LEAVE_TYPE_NAME = "Maternity Leave";

/** Inclusive calendar-day span (matches calculateDaysBetween / calculate_leave_days). */
export const DEFAULT_MATERNITY_ENTITLEMENT_DAYS = 84;

export function isMaternityLeaveTypeName(typeName: string | null | undefined): boolean {
  return (typeName ?? "").trim() === MATERNITY_LEAVE_TYPE_NAME;
}

export function maternityEndDateFromStart(startDate: string): string {
  if (!startDate?.trim()) {
    return "";
  }
  const start = new Date(`${startDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(start.getTime())) {
    return "";
  }
  start.setDate(start.getDate() + DEFAULT_MATERNITY_ENTITLEMENT_DAYS - 1);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatMaternityEntitlementHint(input: {
  entitledDays: number | null | undefined;
  daysRemaining: number | null | undefined;
}): string {
  const entitled = Number(input.entitledDays);
  const remaining = Number(input.daysRemaining);
  const entitledLabel = Number.isFinite(entitled) ? entitled : DEFAULT_MATERNITY_ENTITLEMENT_DAYS;
  const remainingLabel = Number.isFinite(remaining) ? remaining : entitledLabel;
  return `Maternity entitlement: ${entitledLabel} days (remaining ${remainingLabel}). End date defaults to ${DEFAULT_MATERNITY_ENTITLEMENT_DAYS} calendar days from start; you can adjust it.`;
}
