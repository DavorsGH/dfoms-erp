export const COMPASSIONATE_LEAVE_TYPE_NAME = "Compassionate Leave";

export const COMPASSIONATE_LEAVE_FORM_HINT =
  "Compassionate leave is granted case by case; your HR team will confirm the days.";

export function isCompassionateLeaveTypeName(
  typeName: string | null | undefined,
): boolean {
  return typeName?.trim() === COMPASSIONATE_LEAVE_TYPE_NAME;
}
