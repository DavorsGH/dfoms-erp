"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  formatGHS,
  inputClassName,
} from "../employees/employee-record-utils";
import RegisterRowActions, {
  getStripedRowClassName,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import SalaryRates from "./salary-rates";
import type { SalaryRateEntry } from "./salary-rates-utils";
import {
  COMPENSATION_EMPLOYMENT_TYPES,
  COMPENSATION_SHIFTS,
  type AllowanceTypeRow,
  type CompensationPolicyRow,
} from "./compensation-policy-utils";

type TabId = "basic" | "allowances" | "types";

type SalarySettingsProps = {
  tenantId: string;
  initialRates: SalaryRateEntry[];
  initialPositions: string[];
  initialAllowanceTypes: AllowanceTypeRow[];
  initialPolicies: CompensationPolicyRow[];
  fetchError: string | null;
};

const emptyPolicyForm = {
  position: "",
  employment_type: "",
  shift: "",
};

const emptyTypeForm = {
  code: "",
  name: "",
  sort_order: "50",
};

export default function SalarySettings({
  tenantId,
  initialRates,
  initialPositions,
  initialAllowanceTypes,
  initialPolicies,
  fetchError,
}: SalarySettingsProps) {
  const supabase = createClient();
  const [tab, setTab] = useState<TabId>("basic");
  const [positions, setPositions] = useState(initialPositions);
  const [allowanceTypes, setAllowanceTypes] = useState(initialAllowanceTypes);
  const [policies, setPolicies] = useState(initialPolicies);
  const [error, setError] = useState<string | null>(fetchError);
  const [loading, setLoading] = useState(false);

  const [policyForm, setPolicyForm] = useState(emptyPolicyForm);
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [editingPolicyKey, setEditingPolicyKey] = useState<string | null>(null);

  const [typeForm, setTypeForm] = useState(emptyTypeForm);
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  useEffect(() => {
    setPositions(initialPositions);
    setAllowanceTypes(initialAllowanceTypes);
    setPolicies(initialPolicies);
  }, [initialPositions, initialAllowanceTypes, initialPolicies]);

  const activeTypes = useMemo(
    () =>
      allowanceTypes
        .filter((t) => t.is_active)
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [allowanceTypes],
  );

  const positionOptions = useMemo(
    () => [...new Set(positions.filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [positions],
  );

  const policyGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        position: string;
        employment_type: string;
        shift: string;
        amounts: Record<string, number>;
      }
    >();

    for (const row of policies) {
      const key = `${row.position}|${row.employment_type}|${row.shift}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          position: row.position,
          employment_type: row.employment_type,
          shift: row.shift,
          amounts: {},
        };
        map.set(key, group);
      }
      group.amounts[row.allowance_type_id] = Number(row.amount) || 0;
    }

    return [...map.values()].sort((a, b) =>
      `${a.position}${a.employment_type}${a.shift}`.localeCompare(
        `${b.position}${b.employment_type}${b.shift}`,
      ),
    );
  }, [policies]);

  async function refreshPoliciesAndTypes() {
    const [{ data: types, error: typesError }, { data: policyRows, error: policyError }] =
      await Promise.all([
        supabase
          .from("allowance_types")
          .select("id, code, name, is_active, sort_order")
          .eq("tenant_id", tenantId)
          .order("sort_order", { ascending: true }),
        supabase
          .from("compensation_policy")
          .select("*")
          .eq("tenant_id", tenantId),
      ]);

    if (typesError || policyError) {
      setError(typesError?.message ?? policyError?.message ?? "Refresh failed");
      return;
    }

    setAllowanceTypes((types as AllowanceTypeRow[] | null) ?? []);
    setPolicies((policyRows as CompensationPolicyRow[] | null) ?? []);
    setError(null);
  }

  function openAddPolicy() {
    setEditingPolicyKey(null);
    setPolicyForm(emptyPolicyForm);
    const drafts: Record<string, string> = {};
    for (const type of activeTypes) {
      drafts[type.id] = "0";
    }
    setAmountDrafts(drafts);
  }

  function openEditPolicy(group: (typeof policyGroups)[number]) {
    setEditingPolicyKey(group.key);
    setPolicyForm({
      position: group.position,
      employment_type: group.employment_type,
      shift: group.shift,
    });
    const drafts: Record<string, string> = {};
    for (const type of activeTypes) {
      drafts[type.id] = String(group.amounts[type.id] ?? 0);
    }
    setAmountDrafts(drafts);
  }

  function closePolicyForm() {
    setEditingPolicyKey(null);
    setPolicyForm(emptyPolicyForm);
    setAmountDrafts({});
  }

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    if (!policyForm.position || !policyForm.employment_type || !policyForm.shift) {
      setError("Position, employment type, and shift are required.");
      return;
    }
    if (activeTypes.length === 0) {
      setError("Add at least one active allowance type first.");
      return;
    }

    setLoading(true);
    setError(null);

    // Replace all policy rows for this combination.
    const { error: deleteError } = await supabase
      .from("compensation_policy")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("position", policyForm.position)
      .eq("employment_type", policyForm.employment_type)
      .eq("shift", policyForm.shift);

    if (deleteError) {
      setError(deleteError.message);
      setLoading(false);
      return;
    }

    const inserts = activeTypes.map((type) => ({
      tenant_id: tenantId,
      position: policyForm.position,
      employment_type: policyForm.employment_type,
      shift: policyForm.shift,
      allowance_type_id: type.id,
      amount: Number(amountDrafts[type.id]) || 0,
    }));

    const { error: insertError } = await supabase
      .from("compensation_policy")
      .insert(inserts);

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    closePolicyForm();
    await refreshPoliciesAndTypes();
    setLoading(false);
  }

  async function handleDeletePolicyGroup(group: (typeof policyGroups)[number]) {
    if (
      !window.confirm(
        `Delete all allowance amounts for ${group.position} / ${group.employment_type} / ${group.shift}?`,
      )
    ) {
      return;
    }

    setLoading(true);
    const { error: deleteError } = await supabase
      .from("compensation_policy")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("position", group.position)
      .eq("employment_type", group.employment_type)
      .eq("shift", group.shift);

    if (deleteError) {
      setError(deleteError.message);
      setLoading(false);
      return;
    }

    if (editingPolicyKey === group.key) {
      closePolicyForm();
    }
    await refreshPoliciesAndTypes();
    setLoading(false);
  }

  function openAddType() {
    setEditingTypeId(null);
    setTypeForm(emptyTypeForm);
    setShowTypeForm(true);
  }

  function openEditType(type: AllowanceTypeRow) {
    setEditingTypeId(type.id);
    setTypeForm({
      code: type.code,
      name: type.name,
      sort_order: String(type.sort_order),
    });
    setShowTypeForm(true);
  }

  function closeTypeForm() {
    setEditingTypeId(null);
    setTypeForm(emptyTypeForm);
    setShowTypeForm(false);
  }

  async function handleSaveType(e: React.FormEvent) {
    e.preventDefault();
    const code = typeForm.code.trim().toUpperCase().replace(/\s+/g, "_");
    const name = typeForm.name.trim();
    if (!code || !name) {
      setError("Code and name are required.");
      return;
    }

    setLoading(true);
    setError(null);

    const payload = {
      tenant_id: tenantId,
      code,
      name,
      sort_order: Number(typeForm.sort_order) || 0,
      is_active: true,
    };

    const { error: saveError } = editingTypeId
      ? await supabase
          .from("allowance_types")
          .update({ name: payload.name, sort_order: payload.sort_order })
          .eq("id", editingTypeId)
          .eq("tenant_id", tenantId)
      : await supabase.from("allowance_types").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeTypeForm();
    await refreshPoliciesAndTypes();
    setLoading(false);
  }

  async function handleDeactivateType(type: AllowanceTypeRow) {
    if (
      !window.confirm(
        `Deactivate “${type.name}”? It will stop applying to new payroll but history is kept.`,
      )
    ) {
      return;
    }

    setDeactivatingId(type.id);
    setError(null);

    const { error: updateError } = await supabase
      .from("allowance_types")
      .update({ is_active: false })
      .eq("id", type.id)
      .eq("tenant_id", tenantId);

    if (updateError) {
      setError(updateError.message);
      setDeactivatingId(null);
      return;
    }

    if (editingTypeId === type.id) {
      closeTypeForm();
    }
    await refreshPoliciesAndTypes();
    setDeactivatingId(null);
  }

  async function handleReactivateType(type: AllowanceTypeRow) {
    setDeactivatingId(type.id);
    const { error: updateError } = await supabase
      .from("allowance_types")
      .update({ is_active: true })
      .eq("id", type.id)
      .eq("tenant_id", tenantId);

    if (updateError) {
      setError(updateError.message);
      setDeactivatingId(null);
      return;
    }

    await refreshPoliciesAndTypes();
    setDeactivatingId(null);
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "basic", label: "Basic Salary Rates" },
    { id: "allowances", label: "Allowance Matrix" },
    { id: "types", label: "Allowance Types" },
  ];

  const showPolicyForm =
    Object.keys(amountDrafts).length > 0 || editingPolicyKey !== null;

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm text-slate-600">
        Global salary policy: basic rates and allowances by position, employment
        type, and shift. Employee compensation is read-only from this policy.
      </p>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-px">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setError(null);
            }}
            className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === item.id
                ? "border border-b-white border-slate-200 bg-white text-[#0f2744]"
                : "text-slate-600 hover:text-[#0f2744]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && tab !== "basic" ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {tab === "basic" ? (
        <SalaryRates
          initialRates={initialRates}
          initialPositions={positions}
          fetchError={tab === "basic" ? fetchError : null}
        />
      ) : null}

      {tab === "allowances" ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Set flat GHS amounts for each active allowance type per
              Position × Employment Type × Shift.
            </p>
            <button
              type="button"
              onClick={() =>
                showPolicyForm && !editingPolicyKey
                  ? closePolicyForm()
                  : openAddPolicy()
              }
              className="shrink-0 rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
            >
              {showPolicyForm && !editingPolicyKey ? "Cancel" : "Add Combination"}
            </button>
          </div>

          {showPolicyForm ? (
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
                {editingPolicyKey ? "Edit Allowance Combination" : "New Allowance Combination"}
              </h3>
              <form onSubmit={handleSavePolicy} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Position
                    </label>
                    <select
                      required
                      disabled={Boolean(editingPolicyKey)}
                      value={policyForm.position}
                      onChange={(e) =>
                        setPolicyForm((c) => ({ ...c, position: e.target.value }))
                      }
                      className={inputClassName}
                    >
                      <option value="">Select position</option>
                      {positionOptions.map((position) => (
                        <option key={position} value={position}>
                          {position}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Employment Type
                    </label>
                    <select
                      required
                      disabled={Boolean(editingPolicyKey)}
                      value={policyForm.employment_type}
                      onChange={(e) =>
                        setPolicyForm((c) => ({
                          ...c,
                          employment_type: e.target.value,
                        }))
                      }
                      className={inputClassName}
                    >
                      <option value="">Select type</option>
                      {COMPENSATION_EMPLOYMENT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Shift
                    </label>
                    <select
                      required
                      disabled={Boolean(editingPolicyKey)}
                      value={policyForm.shift}
                      onChange={(e) =>
                        setPolicyForm((c) => ({ ...c, shift: e.target.value }))
                      }
                      className={inputClassName}
                    >
                      <option value="">Select shift</option>
                      {COMPENSATION_SHIFTS.map((shift) => (
                        <option key={shift} value={shift}>
                          {shift}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {activeTypes.map((type) => (
                    <div key={type.id}>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        {type.name} (GHS)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amountDrafts[type.id] ?? "0"}
                        onChange={(e) =>
                          setAmountDrafts((c) => ({
                            ...c,
                            [type.id]: e.target.value,
                          }))
                        }
                        className={inputClassName}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:opacity-50"
                  >
                    {loading ? "Saving…" : "Save Combination"}
                  </button>
                  <button
                    type="button"
                    onClick={closePolicyForm}
                    disabled={loading}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Position</th>
                  <th className={scrollableTableThClassName}>Type</th>
                  <th className={scrollableTableThClassName}>Shift</th>
                  {activeTypes.map((type) => (
                    <th key={type.id} className={scrollableTableThClassName}>
                      {type.name}
                    </th>
                  ))}
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {policyGroups.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4 + activeTypes.length}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      No allowance combinations configured yet.
                    </td>
                  </tr>
                ) : (
                  policyGroups.map((group, index) => (
                    <tr key={group.key} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3">{group.position}</td>
                      <td className="px-4 py-3">{group.employment_type}</td>
                      <td className="px-4 py-3">{group.shift}</td>
                      {activeTypes.map((type) => (
                        <td key={type.id} className="px-4 py-3">
                          {formatGHS(group.amounts[type.id] ?? 0)}
                        </td>
                      ))}
                      <RegisterRowActions
                        onEdit={() => openEditPolicy(group)}
                        onDelete={() => handleDeletePolicyGroup(group)}
                        deleting={false}
                      />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      ) : null}

      {tab === "types" ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Admin-configurable allowance types. Deactivate instead of deleting
              so payroll history stays intact.
            </p>
            <button
              type="button"
              onClick={() => (showTypeForm ? closeTypeForm() : openAddType())}
              className="shrink-0 rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
            >
              {showTypeForm ? "Cancel" : "Add Type"}
            </button>
          </div>

          {showTypeForm ? (
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
                {editingTypeId ? "Edit Allowance Type" : "New Allowance Type"}
              </h3>
              <form onSubmit={handleSaveType} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Code
                    </label>
                    <input
                      required
                      disabled={Boolean(editingTypeId)}
                      value={typeForm.code}
                      onChange={(e) =>
                        setTypeForm((c) => ({ ...c, code: e.target.value }))
                      }
                      className={inputClassName}
                      placeholder="e.g. MEAL"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Name
                    </label>
                    <input
                      required
                      value={typeForm.name}
                      onChange={(e) =>
                        setTypeForm((c) => ({ ...c, name: e.target.value }))
                      }
                      className={inputClassName}
                      placeholder="e.g. Meal Allowance"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Sort Order
                    </label>
                    <input
                      type="number"
                      value={typeForm.sort_order}
                      onChange={(e) =>
                        setTypeForm((c) => ({ ...c, sort_order: e.target.value }))
                      }
                      className={inputClassName}
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
                  >
                    {loading ? "Saving…" : editingTypeId ? "Save Changes" : "Add Type"}
                  </button>
                  <button
                    type="button"
                    onClick={closeTypeForm}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Code</th>
                  <th className={scrollableTableThClassName}>Name</th>
                  <th className={scrollableTableThClassName}>Sort</th>
                  <th className={scrollableTableThClassName}>Status</th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {allowanceTypes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      No allowance types yet.
                    </td>
                  </tr>
                ) : (
                  allowanceTypes.map((type, index) => (
                    <tr key={type.id} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3 font-mono text-sm">{type.code}</td>
                      <td className="px-4 py-3">{type.name}</td>
                      <td className="px-4 py-3">{type.sort_order}</td>
                      <td className="px-4 py-3">
                        {type.is_active ? (
                          <span className="text-emerald-700">Active</span>
                        ) : (
                          <span className="text-slate-500">Inactive</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {type.is_active ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditType(type)}
                                className="text-sm font-medium text-[#0f2744] hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={deactivatingId === type.id}
                                onClick={() => handleDeactivateType(type)}
                                className="text-sm font-medium text-amber-700 hover:underline disabled:opacity-50"
                              >
                                Deactivate
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={deactivatingId === type.id}
                              onClick={() => handleReactivateType(type)}
                              className="text-sm font-medium text-emerald-700 hover:underline disabled:opacity-50"
                            >
                              Reactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      ) : null}
    </div>
  );
}
