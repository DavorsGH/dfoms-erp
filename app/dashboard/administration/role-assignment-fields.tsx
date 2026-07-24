"use client";

import type { AppRole, ClientOption, SiteOption } from "../user-account-types";
import { USER_ROLE_OPTIONS } from "../user-account-types";
import {
  roleRequiresClient,
  roleRequiresEmployee,
  roleRequiresSupervisorSites,
  roleShowsEmployeePicker,
} from "../user-account-role-utils";
import type { Employee } from "../lookup-types";

export type RoleAssignmentFormState = {
  role: AppRole | "";
  employee_id: string;
  client_id: string;
  supervisor_site_codes: string[];
};

type RoleAssignmentFieldsProps = {
  form: RoleAssignmentFormState;
  employees: Employee[];
  clients: ClientOption[];
  sites: SiteOption[];
  assignedEmployeeIds: Set<string>;
  assignedClientIds: Set<string>;
  currentEmployeeId?: string | null;
  currentClientId?: string | null;
  onChange: (next: RoleAssignmentFormState) => void;
  idPrefix?: string;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export function createEmptyRoleAssignmentForm(): RoleAssignmentFormState {
  return {
    role: "",
    employee_id: "",
    client_id: "",
    supervisor_site_codes: [],
  };
}

export function roleAssignmentFromAccount(account: {
  role: AppRole;
  employee_id: string | null;
  client_id: string | null;
  supervisor_site_codes: string[];
}): RoleAssignmentFormState {
  return {
    role: account.role,
    employee_id: account.employee_id ?? "",
    client_id: account.client_id ?? "",
    supervisor_site_codes: [...account.supervisor_site_codes],
  };
}

function updateRole(
  current: RoleAssignmentFormState,
  role: AppRole | "",
): RoleAssignmentFormState {
  return {
    role,
    employee_id: roleShowsEmployeePicker(role as AppRole) ? current.employee_id : "",
    client_id: roleRequiresClient(role as AppRole) ? current.client_id : "",
    supervisor_site_codes: roleRequiresSupervisorSites(role as AppRole)
      ? current.supervisor_site_codes
      : [],
  };
}

export default function RoleAssignmentFields({
  form,
  employees,
  clients,
  sites,
  assignedEmployeeIds,
  assignedClientIds,
  currentEmployeeId,
  currentClientId,
  onChange,
  idPrefix = "role",
}: RoleAssignmentFieldsProps) {
  const role = form.role as AppRole | "";
  const availableEmployees = employees.filter(
    (employee) =>
      employee.employee_id === currentEmployeeId ||
      !assignedEmployeeIds.has(employee.employee_id),
  );
  const availableClients = clients.filter(
    (client) =>
      client.client_id === currentClientId ||
      !assignedClientIds.has(client.client_id),
  );

  function toggleSite(siteCode: string) {
    const selected = new Set(form.supervisor_site_codes);
    if (selected.has(siteCode)) {
      selected.delete(siteCode);
    } else {
      selected.add(siteCode);
    }

    onChange({
      ...form,
      supervisor_site_codes: Array.from(selected).sort(),
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label
          htmlFor={`${idPrefix}-role`}
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Role
        </label>
        <select
          id={`${idPrefix}-role`}
          required
          value={form.role}
          onChange={(e) =>
            onChange(updateRole(form, e.target.value as AppRole | ""))
          }
          className={inputClassName}
        >
          <option value="">Select role</option>
          {USER_ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {role && roleShowsEmployeePicker(role) ? (
        <div>
          <label
            htmlFor={`${idPrefix}-employee`}
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Employee{roleRequiresEmployee(role) ? "" : " (optional)"}
          </label>
          <select
            id={`${idPrefix}-employee`}
            required={roleRequiresEmployee(role)}
            value={form.employee_id}
            onChange={(e) =>
              onChange({ ...form, employee_id: e.target.value })
            }
            className={inputClassName}
          >
            <option value="">
              {roleRequiresEmployee(role)
                ? "Select employee"
                : "No employee link"}
            </option>
            {availableEmployees.map((employee) => (
              <option key={employee.employee_id} value={employee.employee_id}>
                {employee.full_name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {role && roleRequiresClient(role) ? (
        <div>
          <label
            htmlFor={`${idPrefix}-client`}
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Customer
          </label>
          <select
            id={`${idPrefix}-client`}
            required
            value={form.client_id}
            onChange={(e) => onChange({ ...form, client_id: e.target.value })}
            className={inputClassName}
          >
            <option value="">Select customer</option>
            {availableClients.map((client) => (
              <option key={client.client_id} value={client.client_id}>
                {client.client_name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {role && roleRequiresSupervisorSites(role) ? (
        <div className="md:col-span-2">
          <p className="mb-2 text-sm font-medium text-slate-700">
            Assigned Sites
          </p>
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-slate-300 bg-white p-3">
            {sites.length === 0 ? (
              <p className="text-sm text-slate-500">No sites available.</p>
            ) : (
              sites.map((site) => {
                const checked = form.supervisor_site_codes.includes(
                  site.site_code,
                );

                return (
                  <label
                    key={site.site_code}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSite(site.site_code)}
                      className="rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                    />
                    <span>
                      {site.site_name}{" "}
                      <span className="text-slate-500">({site.site_code})</span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
