"use client";

import { confirmDialog } from "@/components/feedback/app-dialogs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAlert, useToast } from "@/components/feedback";
import { useRouter } from "next/navigation";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
} from "@/utils/password-policy";
import { parseApiErrorResponse } from "@/utils/parse-api-error";
import type { Employee } from "../lookup-types";
import { getRoleLabel } from "../role-labels";
import ScrollableTable, {
  scrollableTableBodyCellClassNameForHeading,
  scrollableTableClassName,
  scrollableTableCompactCellClassName,
  scrollableTableHeadClassName,
  scrollableTableHeadingClassName,
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";
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
import BusinessUnitAccessFields, {
  businessUnitAccessFromApi,
  emptyBusinessUnitAccessForm,
  type BusinessUnitAccessFormState,
  type BusinessUnitOption,
} from "./business-unit-access-fields";
import PasswordInput from "@/components/password-input";

type UserAccountsProps = {
  initialAccounts: UserAccount[];
  initialEmployees: Employee[];
  initialClients: ClientOption[];
  initialSites: SiteOption[];
  initialBusinessUnits: BusinessUnitOption[];
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

type CreateUserMode = "password" | "invite";

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
    "This will permanently delete this login account. The employee/customer record itself will NOT be deleted. This cannot be undone.",
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
    return `Customer: ${account.client_name}`;
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
  initialBusinessUnits,
  fetchError,
}: UserAccountsProps) {
  const router = useRouter();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const createSubmitGuardRef = useRef(false);
  const updateSubmitGuardRef = useRef(false);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createMode, setCreateMode] = useState<CreateUserMode>("password");
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [businessUnitAccessForm, setBusinessUnitAccessForm] =
    useState<BusinessUnitAccessFormState>(emptyBusinessUnitAccessForm());
  const [createBusinessUnitAccessForm, setCreateBusinessUnitAccessForm] =
    useState<BusinessUnitAccessFormState>(emptyBusinessUnitAccessForm());
  const [businessUnitAccessLoading, setBusinessUnitAccessLoading] =
    useState(false);

  const showBusinessUnitAccess = initialBusinessUnits.length >= 2;

  useEffect(() => {
    setAccounts(initialAccounts);
  }, [initialAccounts]);

  useEffect(() => {
    if (fetchError) {
      void alertError(fetchError, { title: "Could not complete action" });
    }
  }, [alertError, fetchError]);

  async function loadBusinessUnitAccess(authUid: string) {
    if (!showBusinessUnitAccess) {
      setBusinessUnitAccessForm(emptyBusinessUnitAccessForm());
      return;
    }

    setBusinessUnitAccessLoading(true);
    setBusinessUnitAccessForm(emptyBusinessUnitAccessForm());

    try {
      const response = await fetch(
        `/api/admin/users/business-unit-access?auth_uid=${encodeURIComponent(authUid)}`,
      );

      if (!response.ok) {
        setError(
          await parseApiErrorResponse(
            response,
            "Failed to load business unit access",
          ),
        );
        return;
      }

      const payload = (await response.json()) as {
        unrestricted?: boolean;
        business_unit_ids?: string[];
        default_business_unit_id?: string | null;
      };

      setBusinessUnitAccessForm(businessUnitAccessFromApi(payload));
    } finally {
      setBusinessUnitAccessLoading(false);
    }
  }

  function closeEditUser() {
    setEditingUid(null);
  }

  function closeResetPassword() {
    setResettingUid(null);
    setResetPassword("");
  }

  function openEditUser(account: UserAccount) {
    setEditingUid(account.auth_uid);
    setEditForm(editUserFromAccount(account));
    closeResetPassword();
    setError(null);
    setSuccess(null);
    void loadBusinessUnitAccess(account.auth_uid);
  }

  function openResetPassword(account: UserAccount) {
    setResettingUid(account.auth_uid);
    setResetPassword("");
    setEditingUid(null);
    setError(null);
    setSuccess(null);
  }

  useEffect(() => {
    if (!editingUid && !resettingUid) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (resettingUid) {
        closeResetPassword();
      } else {
        closeEditUser();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editingUid, resettingUid]);

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

  const editingAccount = accounts.find(
    (account) => account.auth_uid === editingUid,
  );
  const resettingAccount = accounts.find(
    (account) => account.auth_uid === resettingUid,
  );

  async function syncBusinessUnitAccess(
    authUid: string,
    form: BusinessUnitAccessFormState,
    failureMessage: string,
  ): Promise<boolean> {
    if (!showBusinessUnitAccess) {
      return true;
    }

    const accessResponse = await fetch("/api/admin/users/business-unit-access", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_uid: authUid,
        business_unit_ids: form.business_unit_ids,
        default_business_unit_id: form.default_business_unit_id,
      }),
    });

    if (!accessResponse.ok) {
      setError(await parseApiErrorResponse(accessResponse, failureMessage));
      return false;
    }

    return true;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (createSubmitGuardRef.current || loading) {
      return;
    }
    createSubmitGuardRef.current = true;
    setLoading(true);
    setError(null);
    setSuccess(null);

    const endpoint =
      createMode === "invite"
        ? "/api/admin/users/invite"
        : "/api/admin/users/create";

    const payload =
      createMode === "invite"
        ? {
            email: createForm.email,
            role: createForm.role,
            employee_id: createForm.employee_id,
            client_id: createForm.client_id,
            supervisor_site_codes: createForm.supervisor_site_codes,
            business_unit_ids: createBusinessUnitAccessForm.business_unit_ids,
            default_business_unit_id:
              createBusinessUnitAccessForm.default_business_unit_id,
          }
        : createForm;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await parseApiErrorResponse(
        response,
        createMode === "invite" ? "Failed to send invite" : "Failed to create user",
      );
      void alertError(message, { title: "Could not complete action" });
      createSubmitGuardRef.current = false;
      setLoading(false);
      return;
    }

    const result = (await response.json().catch(() => null)) as {
      auth_uid?: string;
      message?: string;
    } | null;

    if (
      createMode === "password" &&
      result?.auth_uid &&
      !(await syncBusinessUnitAccess(
        result.auth_uid,
        createBusinessUnitAccessForm,
        "User created, but business unit access failed to save",
      ))
    ) {
      createSubmitGuardRef.current = false;
      setLoading(false);
      return;
    }

    setCreateForm(emptyCreateForm());
    setCreateBusinessUnitAccessForm(emptyBusinessUnitAccessForm());
    setCreateMode("password");
    setShowCreateForm(false);
    toast(
      createMode === "invite"
        ? (result?.message ?? "Invite email sent.")
        : "User account created.",
    );
    createSubmitGuardRef.current = false;
    setLoading(false);
    router.refresh();
  }

  async function handleUpdateUser(
    e: React.FormEvent,
    authUid: string,
    displayName: string,
  ) {
    e.preventDefault();
    if (updateSubmitGuardRef.current || actionId === authUid) {
      return;
    }

    const originalAccount = accounts.find((account) => account.auth_uid === authUid);
    if (originalAccount?.is_active && !editForm.is_active) {
      if (!(await confirmDialog({ message: deactivateConfirmMessage(displayName) }))) {
        return;
      }
    }

    updateSubmitGuardRef.current = true;
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

    if (!response.ok) {
      void alertError(
        await parseApiErrorResponse(response, "Failed to update user"),
        { title: "Could not complete action" },
      );
      updateSubmitGuardRef.current = false;
      setActionId(null);
      return;
    }

    if (showBusinessUnitAccess) {
      const accessSaved = await syncBusinessUnitAccess(
        authUid,
        businessUnitAccessForm,
        "User saved, but business unit access failed to update",
      );
      if (!accessSaved) {
        void alertError("User saved, but business unit access failed to update.", {
          title: "Could not complete action",
        });
        updateSubmitGuardRef.current = false;
        setActionId(null);
        return;
      }
    }

    closeEditUser();
    toast(
      originalAccount?.is_active && !editForm.is_active
        ? "User account deactivated."
        : !originalAccount?.is_active && editForm.is_active
          ? "User account reactivated."
          : "User account updated.",
    );
    updateSubmitGuardRef.current = false;
    setActionId(null);
    router.refresh();
  }

  async function handleResetPassword(
    e: React.FormEvent,
    authUid: string,
    displayName: string,
  ) {
    e.preventDefault();
    setActionId(authUid);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/users/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth_uid: authUid, password: resetPassword }),
    });

    if (!response.ok) {
      setError(
        await parseApiErrorResponse(response, "Failed to reset password"),
      );
      setActionId(null);
      return;
    }

    closeResetPassword();
    toast(`Password updated for ${displayName}`);
    setActionId(null);
  }

  async function handleDeactivate(authUid: string, displayName: string) {
    if (!(await confirmDialog({ message: deactivateConfirmMessage(displayName) }))) {
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

    if (!response.ok) {
      setError(
        await parseApiErrorResponse(response, "Failed to deactivate user"),
      );
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

    if (!dependencyResponse.ok) {
      setError(
        await parseApiErrorResponse(
          dependencyResponse,
          "Failed to inspect user dependencies",
        ),
      );
      setActionId(null);
      return;
    }

    const dependencyPayload = (await dependencyResponse.json().catch(() => null)) as {
      error?: string;
      summary?: string;
      canDelete?: boolean;
      blockMessage?: string;
    } | null;

    if (!dependencyPayload) {
      setError("Failed to inspect user dependencies (empty response).");
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
      !(await confirmDialog({
        message: deleteConfirmMessage(displayName, dependencyPayload.summary),
        tone: "danger",
        confirmLabel: "Delete",
      }))
    ) {
      setActionId(null);
      return;
    }

    const response = await fetch("/api/admin/users/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth_uid: authUid }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        dependencySummary?: string;
      } | null;
      const baseMessage =
        payload?.error?.trim() ||
        `Failed to delete user (HTTP ${response.status}).`;
      const detail = payload?.dependencySummary
        ? `${baseMessage}\n\n${payload.dependencySummary}`
        : baseMessage;
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
            setCreateMode("password");
            setCreateBusinessUnitAccessForm(emptyBusinessUnitAccessForm());
            closeEditUser();
            closeResetPassword();
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

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">
              Onboarding method
            </legend>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="create-user-mode"
                checked={createMode === "password"}
                onChange={() => setCreateMode("password")}
                className="h-4 w-4 border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
              />
              Set password now (default)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="create-user-mode"
                checked={createMode === "invite"}
                onChange={() => setCreateMode("invite")}
                className="h-4 w-4 border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
              />
              Send invite email
            </label>
          </fieldset>

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
            {createMode === "password" ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Temporary Password
                </label>
                <PasswordInput
                  required
                  minLength={PASSWORD_MIN_LENGTH}
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
            ) : (
              <div className="flex items-end">
                <p className="text-sm text-slate-600">
                  An email with a link to set their password will be sent to this
                  address. The link expires in 7 days.
                </p>
              </div>
            )}
          </div>

          {showBusinessUnitAccess ? (
            <BusinessUnitAccessFields
              form={createBusinessUnitAccessForm}
              businessUnits={initialBusinessUnits}
              onChange={setCreateBusinessUnitAccessForm}
              idPrefix="create-bu"
            />
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? createMode === "invite"
                ? "Sending invite…"
                : "Creating…"
              : createMode === "invite"
                ? "Send Invite"
                : "Create User"}
          </button>
        </form>
      )}

      <FilteredListCount
        filteredCount={accounts.length}
        totalCount={accounts.length}
        itemSingular="user account"
        itemPlural="user accounts"
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableHeadingClassName("Name")}>Name</th>
              <th className={scrollableTableHeadingClassName("Email")}>Email</th>
              <th className={scrollableTableHeadingClassName("Role")}>Role</th>
              <th className={scrollableTableHeadingClassName("Role Links")}>
                Role Links
              </th>
              <th className={scrollableTableHeadingClassName("Active")}>
                Active
              </th>
              <th className={scrollableTableHeadingClassName("Actions")}>
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
                <tr
                  key={account.auth_uid}
                  className={
                    index % 2 === 1
                      ? "bg-slate-50 text-slate-700"
                      : "text-slate-700"
                  }
                >
                  <td className={scrollableTableBodyCellClassNameForHeading("Name")}>
                    {account.full_name}
                  </td>
                  <td className={scrollableTableBodyCellClassNameForHeading("Email")}>
                    {account.email}
                  </td>
                  <td
                    className={scrollableTableBodyCellClassNameForHeading("Role")}
                  >
                    {getRoleLabel(account.role)}
                  </td>
                  <td
                    className={`${scrollableTableBodyCellClassNameForHeading("Role Links")} text-sm`}
                  >
                    {formatRoleLinks(account, initialSites)}
                  </td>
                  <td
                    className={`${scrollableTableBodyCellClassNameForHeading("Active")} ${scrollableTableCompactCellClassName}`}
                  >
                    {account.is_active ? "Yes" : "No"}
                  </td>
                  <td
                    className={`${scrollableTableBodyCellClassNameForHeading("Actions")} whitespace-nowrap ${scrollableTableCompactCellClassName}`}
                  >
                    <div className="inline-flex flex-nowrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditUser(account)}
                        disabled={actionId === account.auth_uid}
                        className={actionButtonClassName}
                      >
                        Edit User
                      </button>
                      <button
                        type="button"
                        onClick={() => openResetPassword(account)}
                        disabled={
                          !account.is_active || actionId === account.auth_uid
                        }
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
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>

      {editingAccount ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-user-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeEditUser();
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <h3
              id="edit-user-title"
              className="text-lg font-semibold text-[#0f2744]"
            >
              Edit User
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {editingAccount.full_name}
              <span className="text-slate-400"> · </span>
              {editingAccount.email}
            </p>
            <form
              onSubmit={(e) =>
                handleUpdateUser(
                  e,
                  editingAccount.auth_uid,
                  editingAccount.full_name,
                )
              }
              className="mt-4 space-y-4"
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
                    Inactive users are signed out on their next request and
                    cannot access the portal.
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
                currentEmployeeId={editingAccount.employee_id}
                currentClientId={editingAccount.client_id}
                onChange={(next) =>
                  setEditForm((current) => ({
                    ...current,
                    ...next,
                  }))
                }
                idPrefix={`edit-${editingAccount.auth_uid}`}
              />
              {showBusinessUnitAccess ? (
                <BusinessUnitAccessFields
                  form={businessUnitAccessForm}
                  businessUnits={initialBusinessUnits}
                  onChange={setBusinessUnitAccessForm}
                  loading={businessUnitAccessLoading}
                  idPrefix={`edit-bu-${editingAccount.auth_uid}`}
                />
              ) : null}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeEditUser}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionId === editingAccount.auth_uid}
                  className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionId === editingAccount.auth_uid
                    ? "Saving…"
                    : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {resettingAccount ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-password-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeResetPassword();
            }
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <h3
              id="reset-password-title"
              className="text-lg font-semibold text-[#0f2744]"
            >
              Reset password
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {resettingAccount.full_name}
              <span className="text-slate-400"> · </span>
              {resettingAccount.email}
            </p>
            <form
              onSubmit={(e) =>
                handleResetPassword(
                  e,
                  resettingAccount.auth_uid,
                  resettingAccount.full_name,
                )
              }
              className="mt-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="reset-password-field"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  New password
                </label>
                <PasswordInput
                  id="reset-password-field"
                  required
                  autoFocus
                  minLength={PASSWORD_MIN_LENGTH}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className={inputClassName}
                  autoComplete="new-password"
                />
                <p className="mt-2 text-xs text-slate-500">
                  {PASSWORD_POLICY_HINT}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={closeResetPassword}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionId === resettingAccount.auth_uid}
                  className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionId === resettingAccount.auth_uid
                    ? "Saving…"
                    : "Save password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
