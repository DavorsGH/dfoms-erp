export type NamedLookup = {
  name: string;
};

export type Employee = {
  employee_id: string;
  full_name: string;
  staff_id?: string | null;
  employment_status?: string | null;
};

export type Approver = {
  employee_id: string;
  full_name: string;
  staff_id?: string | null;
  employment_status?: string | null;
  /** False when employment is not Active or there is no linked staff login. */
  isActiveApprover?: boolean;
};
