"use client";

import { useState } from "react";
import { useAlert, useToast } from "@/components/feedback/feedback-context";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import type { DutyRosterEmployee } from "./duty-roster-utils";
import type { RotationPlanSite } from "./rotation-plan";

export default function UnassignedStaffPanel({
  clientId,
  employees,
  sites,
  onAssigned,
}: {
  clientId: string;
  employees: DutyRosterEmployee[];
  sites: RotationPlanSite[];
  onAssigned: () => void;
}) {
  const [siteByEmployee, setSiteByEmployee] = useState<Record<string, string>>(
    {},
  );
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const { alertError } = useAlert();

  async function assign(employee: DutyRosterEmployee) {
    const siteCode = siteByEmployee[employee.employee_id]?.trim() ?? "";
    if (!siteCode) {
      setError(`Choose a site for ${employee.full_name}.`);
      return;
    }

    setAssigningId(employee.employee_id);
    setError(null);
    try {
      const response = await fetch("/api/operations/assign-roster-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          employee_id: employee.employee_id,
          site_code: siteCode,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        const message = payload.error ?? "Could not assign the site.";
        setError(message);
        void alertError(message, { title: "Could not assign site" });
        return;
      }
      toast("Site assigned");
      onAssigned();
    } catch {
      setError("Could not assign the site.");
    } finally {
      setAssigningId(null);
    }
  }

  if (employees.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-[#0f2744]">Unassigned staff</h2>
      <p className="mt-1 text-sm text-slate-600">
        New hires and people who changed contract stay here until a site is
        assigned.
      </p>
      {error ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      <div className="mt-4">
      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Staff ID</th>
              <th className={scrollableTableThClassName}>Name</th>
              <th className={scrollableTableThClassName}>Site</th>
              <th className={scrollableTableThClassName}> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {employees.map((employee) => (
              <tr key={employee.employee_id}>
                <td className="px-4 py-3 text-sm">{employee.staff_id}</td>
                <td className="px-4 py-3 text-sm">{employee.full_name}</td>
                <td className="px-4 py-3">
                  <select
                    value={siteByEmployee[employee.employee_id] ?? ""}
                    onChange={(event) =>
                      setSiteByEmployee((current) => ({
                        ...current,
                        [employee.employee_id]: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="">Select site</option>
                    {sites.map((site) => (
                      <option key={site.siteCode} value={site.siteCode}>
                        {site.siteName}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={assigningId === employee.employee_id}
                    onClick={() => void assign(employee)}
                    className="rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {assigningId === employee.employee_id ? "Assigning…" : "Assign"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      </div>
    </section>
  );
}
