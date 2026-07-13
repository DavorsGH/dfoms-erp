export type OvertimeRegisterEntry = {
  id: string;
  date: string;
  employee_id: string;
  hours_worked: number | null;
  overtime_hours: number;
  overtime_rate: number;
  overtime_amount: number | null;
  approved_by: string | null;
};
