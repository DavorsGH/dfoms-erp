"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAlert, useToast } from "@/components/feedback";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseApiErrorResponse } from "@/utils/parse-api-error";
import type { Employee } from "../lookup-types";
import { getRoleLabel } from "../role-labels";
import type {
  ClientOption,
  SiteOption,
  UserAccount,
} from "../user-account-types";
import RoleAssignmentFields, {
  roleAssignmentFromAccount,
  type RoleAssignmentFormState,
} from "./role-assignment-fields";
import BusinessUnitAccessFields, {
  businessUnitAccessFromApi,
  emptyBusinessUnitAccessForm,
  type BusinessUnitAccessFormState,
  type BusinessUnitOption,
} from "./business-unit-access-fields";
import LoginAccessCard from "@/components/portal-login-access/login-access-card";

type UserAccountDetailProps = {
  tenantId: string;
  currentUserAuthUid: string | null;
  account: UserAccount;
  allAccounts: UserAccount[];
  employees: Employee[];
  clients: ClientOption[];
  sites: SiteOption[];
  businessUnits: BusinessUnitOption[];
};

type EditUserFormState = RoleAssignmentFormState & {
  email: string;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function editUserFromAccount(account: UserAccount): EditUserFormState {
  return {
    ...roleAssignmentFromAccount(account),
    email: account.email,
  };
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

export default function UserAccountDetail({
  tenantId,
  currentUserAuthUid,
  account: initialAccount,
  allAccounts,
  employees,
  clients,
  sites,
  businessUnits,
}: UserAccountDetailProps) {
  const router = useRouter();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const updateSubmitGuardRef = useRef(false);
  const [account, setAccount] = useState(initialAccount);
  const [editForm, setEditForm] = useState(() =>
    editUserFromAccount(initialAccount),
  );
  const [businessUnitAccessForm, setBusinessUnitAccessForm] =
    useState<BusinessUnitAccessFormState>(emptyBusinessUnitAccessForm());
  const [businessUnitAccessLoading, setBusinessUnitAccessLoading] =
    useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteEmailConfirm, setDeleteEmailConfirm] = useState("");
  const [deleteDependencySummary, setDeleteDependencySummary] = useState<
    string | null
  >(null);
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState<
    string | null
  >(null);

  const showBusinessUnitAccess = businessUnits.length >= 2;
  const isSelf = account.auth_uid === currentUserAuthUid;

  useEffect(() => {
    setAccount(initialAccount);
    setEditForm(editUserFromAccount(initialAccount));
  }, [initialAccount]);

  useEffect(() => {
    if (!showBusinessUnitAccess) {
      setBusinessUnitAccessForm(emptyBusinessUnitAccessForm());
      return;
    }

    let cancelled = false;
    setBusinessUnitAccessLoading(true);
    setBusinessUnitAccessForm(emptyBusinessUnitAccessForm());

    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/users/business-unit-access?auth_uid=${encodeURIComponent(account.auth_uid)}`,
        );
        if (cancelled) return;
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
        if (!cancelled) {
          setBusinessUnitAccessForm(businessUnitAccessFromApi(payload));
        }
      } finally {
        if (!cancelled) {
          setBusinessUnitAccessLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account.auth_uid, showBusinessUnitAccess]);

  useEffect(() => {
    if (!showDeleteModal) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDeleteModal();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showDeleteModal]);

  const assignedEmployeeIds = useMemo(
    () =>
      new Set(
        allAccounts
          .map((entry) => entry.employee_id)
          .filter((employeeId): employeeId is string => Boolean(employeeId)),
      ),
    [allAccounts],
  );

  const assignedClientIds = useMemo(
    () =>
      new Set(
        allAccounts
          .map((entry) => entry.client_id)
          .filter((clientId): clientId is string => Boolean(clientId)),
      ),
    [allAccounts],
  );

  function closeDeleteModal() {
    setShowDeleteModal(false);
    setDeleteEmailConfirm("");
    setDeleteDependencySummary(null);
    setDeleteBlockedMessage(null);
  }

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

  async function handleUpdateUser(e: React.FormEvent) {
    e.preventDefault();
    if (updateSubmitGuardRef.current || actionId === account.auth_uid) {
      return;
    }

    updateSubmitGuardRef.current = true;
    setActionId(account.auth_uid);
    setError(null);

    const response = await fetch("/api/admin/users/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_uid: account.auth_uid,
        ...editForm,
        is_active: account.is_active,
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
        account.auth_uid,
        businessUnitAccessForm,
        "User saved, but business unit access failed to update",
      );
      if (!accessSaved) {
        void alertError(
          "User saved, but business unit access failed to update.",
          { title: "Could not complete action" },
        );
        updateSubmitGuardRef.current = false;
        setActionId(null);
        return;
      }
    }

    toast("User account updated.");
    updateSubmitGuardRef.current = false;
    setActionId(null);
    router.refresh();
  }

  async function openDeleteModal() {
    if (isSelf) {
      setError("You cannot delete your own account.");
      return;
    }

    setActionId(account.auth_uid);
    setError(null);
    setDeleteEmailConfirm("");
    setDeleteDependencySummary(null);
    setDeleteBlockedMessage(null);

    const dependencyResponse = await fetch(
      `/api/admin/users/delete-dependencies?auth_uid=${encodeURIComponent(account.auth_uid)}`,
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

    if (!dependencyPayload.canDelete) {
      setDeleteBlockedMessage(
        dependencyPayload.blockMessage ??
          "This user account cannot be permanently deleted.",
      );
      setShowDeleteModal(true);
      setActionId(null);
      return;
    }

    setDeleteDependencySummary(dependencyPayload.summary ?? null);
    setShowDeleteModal(true);
    setActionId(null);
  }

  async function handleConfirmDelete() {
    if (isSelf) {
      setError("You cannot delete your own account.");
      closeDeleteModal();
      return;
    }

    const expected = account.email.trim().toLowerCase();
    if (deleteEmailConfirm.trim().toLowerCase() !== expected) {
      setError("Type the user's email exactly to confirm deletion.");
      return;
    }

    setActionId(account.auth_uid);
    setError(null);

    const response = await fetch("/api/admin/users/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth_uid: account.auth_uid }),
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

    toast("User account permanently deleted.");
    setActionId(null);
    closeDeleteModal();
    router.push("/dashboard/user-accounts");
    router.refresh();
  }

  const emailMatches =
    deleteEmailConfirm.trim().toLowerCase() ===
    account.email.trim().toLowerCase();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/user-accounts"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Back to User Accounts
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-[#0f2744]">
              {account.full_name}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{account.email}</p>
            <p className="mt-1 text-sm text-slate-500">
              {getRoleLabel(account.role)}
              <span className="text-slate-300"> · </span>
              {formatRoleLinks(account, sites)}
            </p>
          </div>
          <span
            className={
              account.is_active
                ? "inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200"
                : "inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200"
            }
          >
            {account.is_active ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 whitespace-pre-line">
          {error}
        </div>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-[#0f2744]">Edit User</h3>
        {isSelf ? (
          <>
            <p className="mt-1 text-sm text-slate-600">
              You can&apos;t change your own role or access. Ask another
              administrator.
            </p>
            <div className="mt-4 max-w-md space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  type="email"
                  readOnly
                  value={editForm.email}
                  className={`${inputClassName} bg-slate-50 text-slate-600`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Role
                </label>
                <input
                  type="text"
                  readOnly
                  value={getRoleLabel(account.role)}
                  className={`${inputClassName} bg-slate-50 text-slate-600`}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Update role and related assignments. Use Deactivate / Reactivate
              on the User Accounts list to change login status.
            </p>
            <form onSubmit={handleUpdateUser} className="mt-4 space-y-4">
              <div className="max-w-md">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  type="email"
                  required
                  readOnly
                  value={editForm.email}
                  className={`${inputClassName} bg-slate-50 text-slate-600`}
                />
                <p className="mt-1 text-xs text-slate-500">
                  To change the login email, use Change login email below.
                </p>
              </div>
              <RoleAssignmentFields
                form={editForm}
                employees={employees}
                clients={clients}
                sites={sites}
                assignedEmployeeIds={assignedEmployeeIds}
                assignedClientIds={assignedClientIds}
                currentEmployeeId={account.employee_id}
                currentClientId={account.client_id}
                onChange={(next) =>
                  setEditForm((current) => ({
                    ...current,
                    ...next,
                  }))
                }
                idPrefix={`edit-${account.auth_uid}`}
              />
              {showBusinessUnitAccess ? (
                <BusinessUnitAccessFields
                  form={businessUnitAccessForm}
                  businessUnits={businessUnits}
                  onChange={setBusinessUnitAccessForm}
                  loading={businessUnitAccessLoading}
                  idPrefix={`edit-bu-${account.auth_uid}`}
                />
              ) : null}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="submit"
                  disabled={actionId === account.auth_uid}
                  className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionId === account.auth_uid ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-[#0f2744]">Login access</h3>
        <p className="mt-1 mb-4 text-sm text-slate-600">
          Send a password reset link, set a temporary password, or change the
          login email.
        </p>
        <LoginAccessCard
          asCard={false}
          apiBase="tenant-admin"
          persona="staff"
          tenantId={tenantId}
          authUid={account.auth_uid}
        />
      </section>

      <section className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-red-800">Delete user</h3>
        <p className="mt-1 text-sm text-slate-600">
          Permanently delete this login account. The employee or customer record
          itself will not be deleted. This cannot be undone — prefer Deactivate
          for normal offboarding.
        </p>
        <button
          type="button"
          onClick={() => void openDeleteModal()}
          disabled={isSelf || actionId === account.auth_uid}
          title={
            isSelf ? "You cannot delete your own account" : undefined
          }
          className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionId === account.auth_uid ? "Working…" : "Delete user"}
        </button>
      </section>

      {showDeleteModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-user-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDeleteModal();
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <h3
              id="delete-user-title"
              className="text-lg font-semibold text-red-800"
            >
              Delete user
            </h3>
            {deleteBlockedMessage ? (
              <>
                <p className="mt-3 text-sm text-slate-700 whitespace-pre-line">
                  {deleteBlockedMessage}
                </p>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={closeDeleteModal}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-slate-700">
                  Permanently delete the login account for{" "}
                  <span className="font-medium">{account.full_name}</span>? This
                  cannot be undone.
                </p>
                {deleteDependencySummary ? (
                  <p className="mt-2 text-sm text-slate-600 whitespace-pre-line">
                    Related data found:{"\n"}
                    {deleteDependencySummary}
                  </p>
                ) : null}
                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Type <span className="font-mono">{account.email}</span> to
                    confirm
                  </label>
                  <input
                    type="email"
                    autoFocus
                    value={deleteEmailConfirm}
                    onChange={(e) => setDeleteEmailConfirm(e.target.value)}
                    className={inputClassName}
                    placeholder={account.email}
                  />
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDeleteModal}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmDelete()}
                    disabled={!emailMatches || actionId === account.auth_uid}
                    className="rounded-md border border-red-300 bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionId === account.auth_uid
                      ? "Deleting…"
                      : "Delete permanently"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
