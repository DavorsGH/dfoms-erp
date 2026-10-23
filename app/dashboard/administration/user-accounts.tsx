"use client";

import { confirmDialog } from "@/components/feedback/app-dialogs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAlert, useToast } from "@/components/feedback";
import Link from "next/link";
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
  type RoleAssignmentFormState,
} from "./role-assignment-fields";
import BusinessUnitAccessFields, {
  emptyBusinessUnitAccessForm,
  type BusinessUnitAccessFormState,
  type BusinessUnitOption,
} from "./business-unit-access-fields";
import PasswordInput from "@/components/password-input";

type UserAccountsProps = {
  currentUserAuthUid: string | null;
  initialAccounts: UserAccount[];
  initialEmployees: Employee[];
  initialClients: ClientOption[];
  initialSites: SiteOption[];
  initialBusinessUnits: BusinessUnitOption[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const deactivateButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

const reactivateButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

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

function deactivateConfirmMessage(displayName: string) {
  return `Deactivate ${displayName}? They will be signed out and unable to log in until reactivated.`;
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
  currentUserAuthUid,
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
  const [accounts, setAccounts] = useState(initialAccounts);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createMode, setCreateMode] = useState<CreateUserMode>("password");
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [createBusinessUnitAccessForm, setCreateBusinessUnitAccessForm] =
    useState<BusinessUnitAccessFormState>(emptyBusinessUnitAccessForm());

  const showBusinessUnitAccess = initialBusinessUnits.length >= 2;

  useEffect(() => {
    setAccounts(initialAccounts);
  }, [initialAccounts]);

  useEffect(() => {
    if (fetchError) {
      void alertError(fetchError, { title: "Could not complete action" });
    }
  }, [alertError, fetchError]);

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

  async function handleDeactivate(authUid: string, displayName: string) {
    if (authUid === currentUserAuthUid) {
      setError("You cannot deactivate your own account.");
      return;
    }

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

    toast("User account deactivated.");
    setActionId(null);
    router.refresh();
  }

  async function handleReactivate(authUid: string) {
    setActionId(authUid);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/users/reactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth_uid: authUid }),
    });

    if (!response.ok) {
      setError(
        await parseApiErrorResponse(response, "Failed to reactivate user"),
      );
      setActionId(null);
      return;
    }

    toast("User account reactivated.");
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
            setError(null);
            setSuccess(null);
          }}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showCreateForm ? "Cancel" : "Create User"}
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 whitespace-pre-line">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      {showCreateForm ? (
        <form
          onSubmit={handleCreate}
          className="mb-6 space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4"
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCreateMode("password")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                createMode === "password"
                  ? "bg-[#0f2744] text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Set password
            </button>
            <button
              type="button"
              onClick={() => setCreateMode("invite")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                createMode === "invite"
                  ? "bg-[#0f2744] text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Send invite
            </button>
          </div>

          <div className="max-w-md">
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
            <div className="max-w-md">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Password
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
              <p className="mt-1 text-xs text-slate-500">{PASSWORD_POLICY_HINT}</p>
            </div>
          ) : null}

          <RoleAssignmentFields
            form={createForm}
            employees={initialEmployees}
            clients={initialClients}
            sites={initialSites}
            assignedEmployeeIds={assignedEmployeeIds}
            assignedClientIds={assignedClientIds}
            onChange={(next) =>
              setCreateForm((current) => ({
                ...current,
                ...next,
              }))
            }
            idPrefix="create"
          />

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
      ) : null}

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
              accounts.map((account, index) => {
                const isSelf = account.auth_uid === currentUserAuthUid;
                return (
                  <tr
                    key={account.auth_uid}
                    className={
                      index % 2 === 1
                        ? "bg-slate-50 text-slate-700"
                        : "text-slate-700"
                    }
                  >
                    <td
                      className={scrollableTableBodyCellClassNameForHeading(
                        "Name",
                      )}
                    >
                      <Link
                        href={`/dashboard/user-accounts/${account.auth_uid}`}
                        className="font-medium text-[#0f2744] hover:underline"
                      >
                        {account.full_name}
                      </Link>
                    </td>
                    <td
                      className={scrollableTableBodyCellClassNameForHeading(
                        "Email",
                      )}
                    >
                      {account.email}
                    </td>
                    <td
                      className={scrollableTableBodyCellClassNameForHeading(
                        "Role",
                      )}
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
                        {account.is_active ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleDeactivate(
                                account.auth_uid,
                                account.full_name,
                              )
                            }
                            disabled={
                              isSelf || actionId === account.auth_uid
                            }
                            title={
                              isSelf
                                ? "You cannot deactivate your own account"
                                : undefined
                            }
                            className={deactivateButtonClassName}
                          >
                            {actionId === account.auth_uid
                              ? "Working…"
                              : "Deactivate"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleReactivate(account.auth_uid)}
                            disabled={actionId === account.auth_uid}
                            className={reactivateButtonClassName}
                          >
                            {actionId === account.auth_uid
                              ? "Working…"
                              : "Reactivate"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </section>
  );
}
