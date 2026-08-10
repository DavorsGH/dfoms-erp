"use client";

import type { HrEmployee } from "../../hr-payroll/employee-utils";
import { inputClassName } from "../../hr-payroll/hr-register-utils";
import type { PipelineClient } from "./sales-pipeline-utils";
import type { OpportunityFormState } from "./sales-pipeline-utils";

type OpportunityFormFieldsProps = {
  form: OpportunityFormState;
  clients: PipelineClient[];
  employees: HrEmployee[];
  onFieldChange: (field: keyof OpportunityFormState, value: string) => void;
  showCustomerField?: boolean;
};

export default function OpportunityFormFields({
  form,
  clients,
  employees,
  onFieldChange,
  showCustomerField = true,
}: OpportunityFormFieldsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {showCustomerField ? (
        <div className="md:col-span-2 xl:col-span-3">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Customer *
          </label>
          <select
            required
            value={form.client_id}
            onChange={(event) => onFieldChange("client_id", event.target.value)}
            className={inputClassName}
          >
            <option value="">Select customer</option>
            {clients.map((client) => (
              <option key={client.client_id} value={client.client_id}>
                {client.client_name}
                {client.status ? ` (${client.status})` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Opportunity Name *
        </label>
        <input
          type="text"
          required
          value={form.opportunity_name}
          onChange={(event) =>
            onFieldChange("opportunity_name", event.target.value)
          }
          className={inputClassName}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Estimated Value (GHS)
        </label>
        <input
          type="number"
          min={0}
          step="0.01"
          value={form.estimated_value}
          onChange={(event) =>
            onFieldChange("estimated_value", event.target.value)
          }
          className={inputClassName}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Probability (%)
        </label>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={form.probability}
          onChange={(event) => onFieldChange("probability", event.target.value)}
          className={inputClassName}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Expected Close Date
        </label>
        <input
          type="date"
          value={form.expected_close_date}
          onChange={(event) =>
            onFieldChange("expected_close_date", event.target.value)
          }
          className={inputClassName}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Source
        </label>
        <input
          type="text"
          value={form.source}
          onChange={(event) => onFieldChange("source", event.target.value)}
          placeholder="Referral, website, cold call…"
          className={inputClassName}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Assigned Rep
        </label>
        <select
          value={form.assigned_to}
          onChange={(event) => onFieldChange("assigned_to", event.target.value)}
          className={inputClassName}
        >
          <option value="">Unassigned</option>
          {employees.map((employee) => (
            <option key={employee.employee_id} value={employee.employee_id}>
              {employee.staff_id} — {employee.full_name}
            </option>
          ))}
        </select>
      </div>
      <div className="md:col-span-2 xl:col-span-3">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Notes
        </label>
        <textarea
          rows={2}
          value={form.notes}
          onChange={(event) => onFieldChange("notes", event.target.value)}
          className={inputClassName}
        />
      </div>
    </div>
  );
}
