export type AttendanceRegisterEntry = {
  id: string;
  date: string;
  staff_id: string;
  employment_type: string | null;
  project_assignment: string | null;
  clock_in: string | null;
  clock_out: string | null;
  hours_worked: number | null;
  overtime_hours: number | null;
  attendance_status: string;
};

export const ATTENDANCE_STATUS_OPTIONS = [
  "Present",
  "Absent",
  "Late",
  "On Leave",
] as const;

export const DEFAULT_ATTENDANCE_STATUS = "Present";
