export type DisciplinaryRecordEntry = {
  id: string;
  employee_id: string;
  incident_date: string;
  description: string | null;
  action_taken: string | null;
  warning_level: string | null;
};

/** Fixed set for the form dropdown — adjust if business wants different labels. */
export const WARNING_LEVEL_OPTIONS = [
  "Verbal",
  "Written",
  "Final Warning",
  "Suspension",
  "Termination",
] as const;

export type WarningLevel = (typeof WARNING_LEVEL_OPTIONS)[number];

export const DISCIPLINARY_SELECT =
  "id, employee_id, incident_date, description, action_taken, warning_level";
