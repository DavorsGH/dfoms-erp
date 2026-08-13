"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import RegisterRowActions, {
  getStripedRowClassName,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import type { LeaveApproverConfig } from "../self-service/leave-request-utils";
import {
  LEAVE_ENTITLEMENT_DEFAULT_EMPLOYMENT_TYPE,
  LEAVE_ENTITLEMENT_DEFAULT_LABEL,
  LEAVE_ENTITLEMENT_DEFAULT_POSITION,
  LEAVE_ENTITLEMENT_EMPLOYMENT_TYPES,
  LEAVE_ENTITLEMENT_TYPES,
  defaultLeaveEntitlementDraftValues,
  isLeaveEntitlementDefaultPolicyRow,
  type LeaveEntitlementPolicyRow,
} from "./leave-entitlement-policy-utils";

type TabId = "approver" | "entitlements";

type UserAccountOption = {
  auth_uid: string;
  email: string;
  full_name: string;
};

type LeaveSettingsProps = {
  tenantId: string;
  currentApprover: LeaveApproverConfig | null;
  history: LeaveApproverConfig[];
  userAccounts: UserAccountOption[];
  initialPositions: string[];
  initialPolicies: LeaveEntitlementPolicyRow[];
  fetchError: string | null;
};

const emptyEntitlementForm = {
  position: "",
  employment_type: "",
};

export default function LeaveSettings({
  tenantId,
  currentApprover,
  history,
  userAccounts,
  initialPositions,
  initialPolicies,
  fetchError,
}: LeaveSettingsProps) {
  const supabase = createClient();
  const [tab, setTab] = useState<TabId>("approver");

  const [selectedAuthUid, setSelectedAuthUid] = useState(
    currentApprover?.approver_user_account_id ?? "",
  );
  const [notes, setNotes] = useState("");
  const [approverLoading, setApproverLoading] = useState(false);
  const [approverError, setApproverError] = useState<string | null>(fetchError);
  const [approverSuccess, setApproverSuccess] = useState<string | null>(null);

  const [positions] = useState(initialPositions);
  const [policies, setPolicies] = useState(initialPolicies);
  const [entitlementError, setEntitlementError] = useState<string | null>(
    fetchError,
  );
  const [entitlementLoading, setEntitlementLoading] = useState(false);
  const [entitlementForm, setEntitlementForm] = useState(emptyEntitlementForm);
  const [daysDrafts, setDaysDrafts] = useState<Record<string, string>>({});
  const [editingEntitlementKey, setEditingEntitlementKey] = useState<
    string | null
  >(null);
  const [defaultDaysDrafts, setDefaultDaysDrafts] = useState<
    Record<string, string>
  >(() => defaultLeaveEntitlementDraftValues());
  const [defaultEntitlementDirty, setDefaultEntitlementDirty] = useState(false);
  const [savingDefaultEntitlement, setSavingDefaultEntitlement] =
    useState(false);

  useEffect(() => {
    setPolicies(initialPolicies);
  }, [initialPolicies]);

  useEffect(() => {
    const drafts = defaultLeaveEntitlementDraftValues();
    for (const leaveType of LEAVE_ENTITLEMENT_TYPES) {
      const match = initialPolicies.find(
        (row) =>
          isLeaveEntitlementDefaultPolicyRow(row) &&
          row.leave_type === leaveType,
      );
      if (match) {
        drafts[leaveType] = String(Number(match.entitled_days) || 0);
      }
    }
    setDefaultDaysDrafts(drafts);
    setDefaultEntitlementDirty(false);
  }, [initialPolicies]);

  const positionOptions = useMemo(
    () =>
      [...new Set(positions.filter(Boolean))]
        .filter(
          (position) =>
            position !== LEAVE_ENTITLEMENT_DEFAULT_POSITION &&
            position !== LEAVE_ENTITLEMENT_DEFAULT_LABEL,
        )
        .sort((a, b) => a.localeCompare(b)),
    [positions],
  );

  const positionSpecificPolicies = useMemo(
    () => policies.filter((row) => !isLeaveEntitlementDefaultPolicyRow(row)),
    [policies],
  );

  const hasSavedDefaultEntitlement = useMemo(
    () => policies.some((row) => isLeaveEntitlementDefaultPolicyRow(row)),
    [policies],
  );

  const entitlementGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        position: string;
        employment_type: string;
        days: Record<string, number>;
      }
    >();

    for (const row of positionSpecificPolicies) {
      const key = `${row.position}|${row.employment_type}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          position: row.position,
          employment_type: row.employment_type,
          days: {},
        };
        map.set(key, group);
      }
      group.days[row.leave_type] = Number(row.entitled_days) || 0;
    }

    return [...map.values()].sort((a, b) =>
      `${a.position}${a.employment_type}`.localeCompare(
        `${b.position}${b.employment_type}`,
      ),
    );
  }, [positionSpecificPolicies]);

  const currentLabel =
    currentApprover?.user_accounts?.employees?.full_name ??
    currentApprover?.user_accounts?.email ??
    "Not configured";

  async function handleChangeApprover() {
    if (!selectedAuthUid) {
      setApproverError("Select an approver account.");
      return;
    }

    setApproverLoading(true);
    setApproverError(null);
    setApproverSuccess(null);

    try {
      const response = await fetch("/api/leave/change-approver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approver_auth_uid: selectedAuthUid,
          notes: notes || null,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to change leave approver");
      }

      setApproverSuccess(
        "Leave approver updated. Reload the page to see the latest assignment.",
      );
      setNotes("");
    } catch (changeError) {
      setApproverError(
        changeError instanceof Error
          ? changeError.message
          : "Failed to change leave approver",
      );
    } finally {
      setApproverLoading(false);
    }
  }

  async function refreshPolicies() {
    const { data, error } = await supabase
      .from("leave_entitlement_policy")
      .select("*")
      .eq("tenant_id", tenantId);

    if (error) {
      setEntitlementError(error.message);
      return;
    }

    setPolicies((data as LeaveEntitlementPolicyRow[] | null) ?? []);
    setEntitlementError(null);
  }

  function openAddEntitlement() {
    setEditingEntitlementKey(null);
    setEntitlementForm(emptyEntitlementForm);
    const drafts: Record<string, string> = {};
    for (const leaveType of LEAVE_ENTITLEMENT_TYPES) {
      drafts[leaveType] = leaveType === "Annual Leave" ? "15" : "0";
    }
    setDaysDrafts(drafts);
  }

  function openEditEntitlement(group: (typeof entitlementGroups)[number]) {
    setEditingEntitlementKey(group.key);
    setEntitlementForm({
      position: group.position,
      employment_type: group.employment_type,
    });
    const drafts: Record<string, string> = {};
    for (const leaveType of LEAVE_ENTITLEMENT_TYPES) {
      drafts[leaveType] = String(group.days[leaveType] ?? 0);
    }
    setDaysDrafts(drafts);
  }

  function closeEntitlementForm() {
    setEditingEntitlementKey(null);
    setEntitlementForm(emptyEntitlementForm);
    setDaysDrafts({});
  }

  async function handleSaveEntitlement(e: React.FormEvent) {
    e.preventDefault();
    if (!entitlementForm.position || !entitlementForm.employment_type) {
      setEntitlementError("Position and employment type are required.");
      return;
    }

    setEntitlementLoading(true);
    setEntitlementError(null);

    const { error: deleteError } = await supabase
      .from("leave_entitlement_policy")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("position", entitlementForm.position)
      .eq("employment_type", entitlementForm.employment_type);

    if (deleteError) {
      setEntitlementError(deleteError.message);
      setEntitlementLoading(false);
      return;
    }

    const inserts = LEAVE_ENTITLEMENT_TYPES.map((leaveType) => ({
      tenant_id: tenantId,
      position: entitlementForm.position,
      employment_type: entitlementForm.employment_type,
      leave_type: leaveType,
      entitled_days: Number(daysDrafts[leaveType]) || 0,
    }));

    const { error: insertError } = await supabase
      .from("leave_entitlement_policy")
      .insert(inserts);

    if (insertError) {
      setEntitlementError(insertError.message);
      setEntitlementLoading(false);
      return;
    }

    closeEntitlementForm();
    await refreshPolicies();
    setEntitlementLoading(false);
  }

  async function handleSaveDefaultEntitlement(e: React.FormEvent) {
    e.preventDefault();
    setSavingDefaultEntitlement(true);
    setEntitlementError(null);

    const { error: deleteError } = await supabase
      .from("leave_entitlement_policy")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("position", LEAVE_ENTITLEMENT_DEFAULT_POSITION)
      .eq("employment_type", LEAVE_ENTITLEMENT_DEFAULT_EMPLOYMENT_TYPE);

    if (deleteError) {
      setEntitlementError(deleteError.message);
      setSavingDefaultEntitlement(false);
      return;
    }

    const inserts = LEAVE_ENTITLEMENT_TYPES.map((leaveType) => ({
      tenant_id: tenantId,
      position: LEAVE_ENTITLEMENT_DEFAULT_POSITION,
      employment_type: LEAVE_ENTITLEMENT_DEFAULT_EMPLOYMENT_TYPE,
      leave_type: leaveType,
      entitled_days: Number(defaultDaysDrafts[leaveType]) || 0,
    }));

    const { error: insertError } = await supabase
      .from("leave_entitlement_policy")
      .insert(inserts);

    if (insertError) {
      setEntitlementError(insertError.message);
      setSavingDefaultEntitlement(false);
      return;
    }

    setDefaultEntitlementDirty(false);
    await refreshPolicies();
    setSavingDefaultEntitlement(false);
  }

  async function handleDeleteEntitlementGroup(
    group: (typeof entitlementGroups)[number],
  ) {
    if (
      !window.confirm(
        `Delete leave entitlements for ${group.position} / ${group.employment_type}?`,
      )
    ) {
      return;
    }

    setEntitlementLoading(true);
    const { error: deleteError } = await supabase
      .from("leave_entitlement_policy")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("position", group.position)
      .eq("employment_type", group.employment_type);

    if (deleteError) {
      setEntitlementError(deleteError.message);
      setEntitlementLoading(false);
      return;
    }

    if (editingEntitlementKey === group.key) {
      closeEntitlementForm();
    }
    await refreshPolicies();
    setEntitlementLoading(false);
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "approver", label: "Leave Approver" },
    { id: "entitlements", label: "Leave Entitlements" },
  ];

  const showEntitlementForm =
    Object.keys(daysDrafts).length > 0 || editingEntitlementKey !== null;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-px">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
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

      {tab === "approver" ? (
        <div className="space-y-6">
          {approverError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {approverError}
            </div>
          ) : null}

          {approverSuccess ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {approverSuccess}
            </div>
          ) : null}

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-2 text-lg font-semibold text-[#0f2744]">
              Current Leave Approver
            </h3>
            <p className="text-sm text-slate-700">{currentLabel}</p>
            {currentApprover?.effective_from ? (
              <p className="mt-1 text-xs text-slate-500">
                Effective from {currentApprover.effective_from}
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
              Change Approver
            </h3>
            <div className="grid max-w-xl gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  New Approver
                </label>
                <select
                  value={selectedAuthUid}
                  onChange={(event) => setSelectedAuthUid(event.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select user account</option>
                  {userAccounts.map((account) => (
                    <option key={account.auth_uid} value={account.auth_uid}>
                      {account.full_name} ({account.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  className={inputClassName}
                  placeholder="Optional reason for approver change"
                />
              </div>

              <button
                type="button"
                onClick={() => void handleChangeApprover()}
                disabled={approverLoading}
                className="w-fit rounded-md bg-[#0f2744] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
              >
                {approverLoading ? "Saving…" : "Change Approver"}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
              Approver History
            </h3>
            <ul className="space-y-2 text-sm text-slate-700">
              {history.length === 0 ? (
                <li>No approver history yet.</li>
              ) : (
                history.map((entry) => (
                  <li key={entry.id} className="rounded-md bg-slate-50 px-3 py-2">
                    {entry.user_accounts?.employees?.full_name ??
                      entry.user_accounts?.email ??
                      entry.approver_user_account_id}{" "}
                    — effective {entry.effective_from}
                    {entry.notes ? ` (${entry.notes})` : ""}
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "entitlements" ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Default leave days by Position × Employment Type. Applied only when
              creating new leave balance rows (on hire, new year, or first
              approval). Positions without a specific row use{" "}
              <span className="font-medium">{LEAVE_ENTITLEMENT_DEFAULT_LABEL}</span>{" "}
              below. Existing balances are never overwritten.
            </p>
            <button
              type="button"
              onClick={() =>
                showEntitlementForm && !editingEntitlementKey
                  ? closeEntitlementForm()
                  : openAddEntitlement()
              }
              className="shrink-0 rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
            >
              {showEntitlementForm && !editingEntitlementKey
                ? "Cancel"
                : "Add Combination"}
            </button>
          </div>

          {entitlementError ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {entitlementError}
            </p>
          ) : null}

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-[#0f2744]">
                  {LEAVE_ENTITLEMENT_DEFAULT_LABEL}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Used when no position-specific entitlement row matches.
                  {!hasSavedDefaultEntitlement
                    ? " Values below start from the system fallback (Annual 15 / Sick 0 / Unpaid 0) until you save."
                    : null}
                </p>
              </div>
            </div>
            <form
              onSubmit={(e) => void handleSaveDefaultEntitlement(e)}
              className="space-y-4"
            >
              <div className="grid gap-4 md:grid-cols-3">
                {LEAVE_ENTITLEMENT_TYPES.map((leaveType) => (
                  <div key={leaveType}>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      {leaveType} (days)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      required
                      value={defaultDaysDrafts[leaveType] ?? "0"}
                      onChange={(event) => {
                        setDefaultEntitlementDirty(true);
                        setDefaultDaysDrafts((current) => ({
                          ...current,
                          [leaveType]: event.target.value,
                        }));
                      }}
                      className={inputClassName}
                    />
                  </div>
                ))}
              </div>
              <button
                type="submit"
                disabled={
                  savingDefaultEntitlement ||
                  entitlementLoading ||
                  (!defaultEntitlementDirty && hasSavedDefaultEntitlement)
                }
                className="rounded-md bg-[#0f2744] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
              >
                {savingDefaultEntitlement ? "Saving…" : "Save Default"}
              </button>
            </form>
          </section>

          {showEntitlementForm ? (
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
                {editingEntitlementKey
                  ? "Edit Leave Entitlement"
                  : "New Leave Entitlement"}
              </h3>
              <form onSubmit={(e) => void handleSaveEntitlement(e)} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Position
                    </label>
                    <select
                      required
                      disabled={Boolean(editingEntitlementKey)}
                      value={entitlementForm.position}
                      onChange={(e) =>
                        setEntitlementForm((c) => ({
                          ...c,
                          position: e.target.value,
                        }))
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
                      disabled={Boolean(editingEntitlementKey)}
                      value={entitlementForm.employment_type}
                      onChange={(e) =>
                        setEntitlementForm((c) => ({
                          ...c,
                          employment_type: e.target.value,
                        }))
                      }
                      className={inputClassName}
                    >
                      <option value="">Select type</option>
                      {LEAVE_ENTITLEMENT_EMPLOYMENT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  {LEAVE_ENTITLEMENT_TYPES.map((leaveType) => (
                    <div key={leaveType}>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        {leaveType} (days)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        required
                        value={daysDrafts[leaveType] ?? "0"}
                        onChange={(e) =>
                          setDaysDrafts((c) => ({
                            ...c,
                            [leaveType]: e.target.value,
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
                    disabled={entitlementLoading}
                    className="rounded-md bg-[#0f2744] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
                  >
                    {entitlementLoading ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={closeEntitlementForm}
                    className="rounded-md border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    <th className={scrollableTableThClassName}>Position</th>
                    <th className={scrollableTableThClassName}>
                      Employment Type
                    </th>
                    {LEAVE_ENTITLEMENT_TYPES.map((leaveType) => (
                      <th key={leaveType} className={scrollableTableThClassName}>
                        {leaveType}
                      </th>
                    ))}
                    <th className={scrollableTableThClassName}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entitlementGroups.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3 + LEAVE_ENTITLEMENT_TYPES.length}
                        className="px-4 py-6 text-center text-sm text-slate-500"
                      >
                        No position-specific leave entitlements yet. New balances
                        for unmatched positions use{" "}
                        {LEAVE_ENTITLEMENT_DEFAULT_LABEL} above.
                      </td>
                    </tr>
                  ) : (
                    entitlementGroups.map((group, index) => (
                      <tr
                        key={group.key}
                        className={getStripedRowClassName(index)}
                      >
                        <td className="px-4 py-3 text-sm text-slate-800">
                          {group.position}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-800">
                          {group.employment_type}
                        </td>
                        {LEAVE_ENTITLEMENT_TYPES.map((leaveType) => (
                          <td
                            key={leaveType}
                            className="px-4 py-3 text-sm tabular-nums text-slate-800"
                          >
                            {group.days[leaveType] ?? 0}
                          </td>
                        ))}
                        <td className="px-4 py-3">
                          <RegisterRowActions
                            onEdit={() => openEditEntitlement(group)}
                            onDelete={() =>
                              void handleDeleteEntitlementGroup(group)
                            }
                            disableEdit={entitlementLoading}
                            disableDelete={entitlementLoading}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          </section>
        </div>
      ) : null}
    </div>
  );
}
