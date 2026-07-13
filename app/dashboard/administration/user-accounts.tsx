"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Employee } from "../lookup-types";
import { getRoleLabel } from "../role-labels";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import type { UserAccount } from "../user-account-types";
import { USER_ROLE_OPTIONS } from "../user-account-types";

type UserAccountsProps = {
  initialAccounts: UserAccount[];
  initialEmployees: Employee[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const actionButtonClassName =
  "rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const deactivateButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

const emptyCreateForm = {
  employee_id: "",
  email: "",
  password: "",
  role: "",
};

export default function UserAccounts({
  initialAccounts,
  initialEmployees,
  fetchError,
}: UserAccountsProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [employees] = useState(initialEmployees);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [resettingUid, setResettingUid] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setAccounts(initialAccounts);
  }, [initialAccounts]);

  const assignedEmployeeIds = new Set(accounts.map((account) => account.employee_id));
  const availableEmployees = employees.filter(
    (employee) => !assignedEmployeeIds.has(employee.employee_id),
  );

  function updateCreateField(
    field: keyof typeof emptyCreateForm,
    value: string,
  ) {
    setCreateForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createForm),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Failed to create user");
      setLoading(false);
      return;
    }

    setCreateForm(emptyCreateForm);
    setShowCreateForm(false);
    setSuccess("User account created.");
    setLoading(false);
    router.refresh();
  }

  async function handleResetPassword(e: React.FormEvent, authUid: string) {
    e.preventDefault();
    setActionId(authUid);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/users/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth_uid: authUid, password: resetPassword }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Failed to reset password");
      setActionId(null);
      return;
    }

    setResettingUid(null);
    setResetPassword("");
    setSuccess("Password reset successfully.");
    setActionId(null);
  }

  async function handleDeactivate(authUid: string, employeeName: string) {
    if (
      !window.confirm(
        `Deactivate the account for ${employeeName}? They will no longer be able to sign in.`,
      )
    ) {
      return;
    }

    setActionId(authUid);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/users/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth_uid: authUid }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Failed to deactivate user");
      setActionId(null);
      return;
    }

    setSuccess("User account deactivated.");
    setActionId(null);
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-[#0f2744]">User Accounts</h2>
        <button
          type="button"
          onClick={() => {
            setShowCreateForm((current) => !current);
            setError(null);
            setSuccess(null);
          }}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showCreateForm ? "Cancel" : "Create User"}
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {success && (
        <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      )}

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-2"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Employee
            </label>
            <select
              required
              value={createForm.employee_id}
              onChange={(e) => updateCreateField("employee_id", e.target.value)}
              className={inputClassName}
            >
              <option value="">Select employee</option>
              {availableEmployees.map((employee) => (
                <option key={employee.employee_id} value={employee.employee_id}>
                  {employee.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              type="email"
              required
              value={createForm.email}
              onChange={(e) => updateCreateField("email", e.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Temporary Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={createForm.password}
              onChange={(e) => updateCreateField("password", e.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Role
            </label>
            <select
              required
              value={createForm.role}
              onChange={(e) => updateCreateField("role", e.target.value)}
              className={inputClassName}
            >
              <option value="">Select role</option>
              {USER_ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={loading || availableEmployees.length === 0}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create User"}
            </button>
          </div>
        </form>
      )}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Employee Name</th>
              <th className={scrollableTableThClassName}>Email</th>
              <th className={scrollableTableThClassName}>Role</th>
              <th className={scrollableTableThClassName}>Active</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {accounts.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No user accounts yet.
                </td>
              </tr>
            ) : (
              accounts.map((account, index) => (
                <Fragment key={account.auth_uid}>
                  <tr
                    className={
                      index % 2 === 1
                        ? "bg-slate-50 text-slate-700"
                        : "text-slate-700"
                    }
                  >
                    <td className="px-4 py-3">{account.full_name}</td>
                    <td className="px-4 py-3">{account.email}</td>
                    <td className="px-4 py-3">
                      {getRoleLabel(account.role)}
                    </td>
                    <td className="px-4 py-3">
                      {account.is_active ? "Yes" : "No"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setResettingUid(account.auth_uid);
                            setResetPassword("");
                            setError(null);
                            setSuccess(null);
                          }}
                          disabled={!account.is_active || actionId === account.auth_uid}
                          className={actionButtonClassName}
                        >
                          Reset Password
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleDeactivate(account.auth_uid, account.full_name)
                          }
                          disabled={
                            !account.is_active || actionId === account.auth_uid
                          }
                          className={deactivateButtonClassName}
                        >
                          {actionId === account.auth_uid
                            ? "Working…"
                            : "Deactivate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {resettingUid === account.auth_uid && (
                    <tr className="bg-slate-50">
                      <td colSpan={5} className="px-4 py-4">
                        <form
                          onSubmit={(e) =>
                            handleResetPassword(e, account.auth_uid)
                          }
                          className="flex flex-col gap-3 sm:flex-row sm:items-end"
                        >
                          <div className="flex-1">
                            <label className="mb-1 block text-sm font-medium text-slate-700">
                              New Password for {account.full_name}
                            </label>
                            <input
                              type="password"
                              required
                              minLength={6}
                              value={resetPassword}
                              onChange={(e) => setResetPassword(e.target.value)}
                              className={inputClassName}
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              disabled={actionId === account.auth_uid}
                              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {actionId === account.auth_uid
                                ? "Saving…"
                                : "Save Password"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setResettingUid(null);
                                setResetPassword("");
                              }}
                              className={actionButtonClassName}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </section>
  );
}
