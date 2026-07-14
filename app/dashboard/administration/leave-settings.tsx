"use client";

import { useState } from "react";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import type { LeaveApproverConfig } from "../self-service/leave-request-utils";

type UserAccountOption = {
  auth_uid: string;
  email: string;
  full_name: string;
};

type LeaveSettingsProps = {
  currentApprover: LeaveApproverConfig | null;
  history: LeaveApproverConfig[];
  userAccounts: UserAccountOption[];
  fetchError: string | null;
};

export default function LeaveSettings({
  currentApprover,
  history,
  userAccounts,
  fetchError,
}: LeaveSettingsProps) {
  const [selectedAuthUid, setSelectedAuthUid] = useState(
    currentApprover?.approver_user_account_id ?? "",
  );
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);

  const currentLabel =
    currentApprover?.user_accounts?.employees?.full_name ??
    currentApprover?.user_accounts?.email ??
    "Not configured";

  async function handleChangeApprover() {
    if (!selectedAuthUid) {
      setError("Select an approver account.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

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

      setSuccess("Leave approver updated. Reload the page to see the latest assignment.");
      setNotes("");
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : "Failed to change leave approver",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
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
            disabled={loading}
            className="w-fit rounded-md bg-[#0f2744] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
          >
            {loading ? "Saving…" : "Change Approver"}
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
  );
}
