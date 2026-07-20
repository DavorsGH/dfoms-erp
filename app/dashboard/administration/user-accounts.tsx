"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Employee } from "../lookup-types";
import { getRoleLabel } from "../role-labels";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import type {
  ClientOption,
  SiteOption,
  UserAccount,
} from "../user-account-types";
import RoleAssignmentFields, {
  createEmptyRoleAssignmentForm,
  roleAssignmentFromAccount,
  type RoleAssignmentFormState,
} from "./role-assignment-fields";
import PasswordInput from "@/components/password-input";

type UserAccountsProps = {
  initialAccounts: UserAccount[];
  initialEmployees: Employee[];
  initialClients: ClientOption[];
  initialSites: SiteOption[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const actionButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const deactivateButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

const deleteButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-800 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50";

type CreateFormState = RoleAssignmentFormState & {
  email: string;
  password: string;
};

const emptyCreateForm = (): CreateFormState => ({
  ...createEmptyRoleAssignmentForm(),
  email: "",
  password: "",
});

type EditUserFormState = RoleAssignmentFormState & {
  email: string;
  is_active: boolean;
};

function editUserFromAccount(account: UserAccount): EditUserFormState {
  return {
    ...roleAssignmentFromAccount(account),
    email: account.email,
    is_active: account.is_active,
  };
}

function deactivateConfirmMessage(displayName: string) {
  return `Deactivate the account for ${displayName}? They will no longer be able to sign in. This is reversible — use Edit User to reactivate later.`;
}

function deleteConfirmMessage(displayName: string, dependencySummary?: string) {
  const lines = [
    `Permanently delete the login account for ${displayName}?`,
    "",
    "This will permanently delete this login account. The employee/client record itself will NOT be deleted. This cannot be undone.",
    "",
    "Deactivate is the recommended option for normal offboarding because it can be reversed.",
  ];
  if (dependencySummary) {
    lines.push("", "Related data found:", dependencySummary);
  }
  return lines.join("\n");
}

function formatRoleLinks(account: UserAccount, sites: SiteOption[]) {
  if (account.role === "client" && account.client_name) {
    return `Client: ${account.client_name}`;
  }

  if (account.role === "supervisor" && account.supervisor_site_codes.length > 0) {
    const labels = account.supervisor_site_codes.map((siteCode) => {
      const site = sites.find((entry) => entry.site_code === siteCode);
      return site ? site.site_name : siteCode;
    });

    return `Sites: ${labels.join(", ")}`;
  }

  if (account.role === "employee" && account.employee_id) {
    return `Employee: ${account.full_name}`;
  }

  if (account.employee_id) {
    return `Employee: ${account.full_name}`;
  }

  return "—";
}

export default function UserAccounts({
  initialAccounts,
  initialEmployees,
  initialClients,
  initialSites,
  fetchError,
}: UserAccountsProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditUserFormState>({
    ...createEmptyRoleAssignmentForm(),
    email: "",
    is_active: true,
  });
  const [resettingUid, setResettingUid] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setAccounts(initialAccounts);
  }, [initialAccounts]);

  const assignedEmployeeIds = useMemo(
    () =>
      new Set(
        accounts
          .map((account) => account.employee_id)
          .filter((employeeId): employeeId is string => Boolean(employeeId)),
      ),
    [accounts],
  );

  const assignedClientIds = useMemo(
    () =>
      new Set(
        accounts
          .map((account) => account.client_id)
          .filter((clientId): clientId is string => Boolean(clientId)),
      ),
    [accounts],
  );

  const editingAccount = accounts.find((account) => account.auth_uid === editingUid);

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

    setCreateForm(emptyCreateForm());
    setShowCreateForm(false);
    setSuccess("User account created.");
    setLoading(false);
    router.refresh();
  }

  async function handleUpdateUser(
    e: React.FormEvent,
    authUid: string,
    displayName: string,
  ) {
    e.preventDefault();

    const originalAccount = accounts.find((account) => account.auth_uid === authUid);
    if (originalAccount?.is_active && !editForm.is_active) {
      if (!window.confirm(deactivateConfirmMessage(displayName))) {
        return;
      }
    }

    setActionId(authUid);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/users/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_uid: authUid,
        ...editForm,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Failed to update user");
      setActionId(null);
      return;
    }

    setEditingUid(null);
    setSuccess(
      originalAccount?.is_active && !editForm.is_active
        ? "User account deactivated."
        : !originalAccount?.is_active && editForm.is_active
          ? "User account reactivated."
          : "User account updated.",
    );
    setActionId(null);
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

  async function handleDeactivate(authUid: string, displayName: string) {
    if (!window.confirm(deactivateConfirmMessage(displayName))) {
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

  async function handleDeleteUser(authUid: string, displayName: string) {
    setActionId(authUid);
    setError(null);
    setSuccess(null);

    const dependencyResponse = await fetch(
      `/api/admin/users/delete-dependencies?auth_uid=${encodeURIComponent(authUid)}`,
    );
    const dependencyPayload = (await dependencyResponse.json().catch(() => null)) as {
      error?: string;
      summary?: string;
      canDelete?: boolean;
      blockMessage?: string;
    } | null;

    if (!dependencyResponse.ok) {
      setError(dependencyPayload?.error ?? "Failed to inspect user dependencies");
      setActionId(null);
      return;
    }

    if (!dependencyPayload?.canDelete) {
      setError(
        dependencyPayload?.blockMessage ??
          "This user account cannot be permanently deleted.",
      );
      setActionId(null);
      return;
    }

    if (
      !window.confirm(
        deleteConfirmMessage(displayName, dependencyPayload.summary),
      )
    ) {
      setActionId(null);
      return;
    }

    const response = await fetch("/api/admin/users/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth_uid: authUid }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      dependencySummary?: string;
    } | null;

    if (!response.ok) {
      const detail = payload?.dependencySummary
        ? `${payload.error ?? "Failed to delete user"}\n\n${payload.dependencySummary}`
        : (payload?.error ?? "Failed to delete user");
      setError(detail);
      setActionId(null);
      return;
    }

    setSuccess("User account permanently deleted.");
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
            setEditingUid(null);
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
          className="mb-6 space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4"
        >
          <RoleAssignmentFields
            form={createForm}
            employees={initialEmployees}
            clients={initialClients}
            sites={initialSites}
            assignedEmployeeIds={assignedEmployeeIds}
            assignedClientIds={assignedClientIds}
            onChange={(next) => setCreateForm((current) => ({ ...current, ...next }))}
            idPrefix="create"
          />

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                type="email"
                required
                value={createForm.email}
                onChange={(e) =>
                  setCreateForm((current) => ({
                    ...current,
                    email: e.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Temporary Password
              </label>
              <PasswordInput
                required
                minLength={6}
                value={createForm.password}
                onChange={(e) =>
                  setCreateForm((current) => ({
                    ...current,
                    password: e.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create User"}
          </button>
        </form>
      )}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Name</th>
              <th className={scrollableTableThClassName}>Email</th>
              <th className={scrollableTableThClassName}>Role</th>
              <th className={scrollableTableThClassName}>Role Links</th>
              <th className={scrollableTableThClassName}>Active</th>
              <th className={`${scrollableTableThClassName} w-[1%] whitespace-nowrap`}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {accounts.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
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
                    <td className="px-4 py-3 text-sm">
                      {formatRoleLinks(account, initialSites)}
                    </td>
                    <td className="px-4 py-3">
                      {account.is_active ? "Yes" : "No"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="inline-flex flex-nowrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingUid(account.auth_uid);
                            setEditForm(editUserFromAccount(account));
                            setResettingUid(null);
                            setError(null);
                            setSuccess(null);
                          }}
                          disabled={actionId === account.auth_uid}
                          className={actionButtonClassName}
                        >
                          Edit User
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResettingUid(account.auth_uid);
                            setResetPassword("");
                            setEditingUid(null);
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
                        <button
                          type="button"
                          onClick={() =>
                            handleDeleteUser(account.auth_uid, account.full_name)
                          }
                          disabled={actionId === account.auth_uid}
                          className={deleteButtonClassName}
                        >
                          Delete User
                        </button>
                      </div>
                    </td>
                  </tr>

                  {editingUid === account.auth_uid && (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="px-4 py-4">
                        <form
                          onSubmit={(e) =>
                            handleUpdateUser(
                              e,
                              account.auth_uid,
                              account.full_name,
                            )
                          }
                          className="space-y-4"
                        >
                          <div className="max-w-md">
                            <label className="mb-1 block text-sm font-medium text-slate-700">
                              Email
                            </label>
                            <input
                              type="email"
                              required
                              value={editForm.email}
                              onChange={(e) =>
                                setEditForm((current) => ({
                                  ...current,
                                  email: e.target.value,
                                }))
                              }
                              className={inputClassName}
                            />
                          </div>
                          <div>
                            <span className="mb-1 block text-sm font-medium text-slate-700">
                              Account Status
                            </span>
                            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={editForm.is_active}
                                onChange={(e) =>
                                  setEditForm((current) => ({
                                    ...current,
                                    is_active: e.target.checked,
                                  }))
                                }
                                className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                              />
                              {editForm.is_active ? "Active" : "Inactive"}
                            </label>
                            {!editForm.is_active && (
                              <p className="mt-1 text-xs text-slate-500">
                                Inactive users are signed out on their next
                                request and cannot access the portal.
                              </p>
                            )}
                          </div>
                          <RoleAssignmentFields
                            form={editForm}
                            employees={initialEmployees}
                            clients={initialClients}
                            sites={initialSites}
                            assignedEmployeeIds={assignedEmployeeIds}
                            assignedClientIds={assignedClientIds}
                            currentEmployeeId={editingAccount?.employee_id}
                            currentClientId={editingAccount?.client_id}
                            onChange={(next) =>
                              setEditForm((current) => ({
                                ...current,
                                ...next,
                              }))
                            }
                            idPrefix={`edit-${account.auth_uid}`}
                          />
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              disabled={actionId === account.auth_uid}
                              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {actionId === account.auth_uid
                                ? "Saving…"
                                : "Save User"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingUid(null)}
                              className={actionButtonClassName}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}

                  {resettingUid === account.auth_uid && (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="px-4 py-4">
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
                            <PasswordInput
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
