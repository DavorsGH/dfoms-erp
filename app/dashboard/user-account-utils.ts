import type { AppRole, UserAccount } from "./user-account-types";

type UserAccountRow = {
  auth_uid: string;
  employee_id: string | null;
  email: string;
  role: AppRole;
  is_active: boolean;
  client_id: string | null;
  employees: { full_name: string } | { full_name: string }[] | null;
  clients: { client_name: string } | { client_name: string }[] | null;
  user_account_supervisor_sites:
    | { site_code: string }
    | { site_code: string }[]
    | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function relationList<T>(value: T | T[] | null | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function mapUserAccountRows(rows: UserAccountRow[]): UserAccount[] {
  return rows.map((row) => {
    const employee = firstRelation(row.employees);
    const client = firstRelation(row.clients);
    const supervisorSites = relationList(row.user_account_supervisor_sites);

    const fullName =
      employee?.full_name ??
      client?.client_name ??
      row.employee_id ??
      row.email;

    return {
      auth_uid: row.auth_uid,
      employee_id: row.employee_id,
      email: row.email,
      role: row.role,
      is_active: row.is_active,
      full_name: fullName,
      client_id: row.client_id,
      client_name: client?.client_name ?? null,
      supervisor_site_codes: supervisorSites.map((site) => site.site_code),
    };
  });
}

export const USER_ACCOUNT_SELECT =
  "auth_uid, employee_id, email, role, is_active, client_id, employees(full_name), clients:customers!user_accounts_client_id_fkey(client_name), user_account_supervisor_sites(site_code)";
