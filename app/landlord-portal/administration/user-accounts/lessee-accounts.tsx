"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  portalDangerButtonClassName,
  portalErrorBannerClassName,
  portalInputClassName,
  portalSecondaryButtonClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

export type LandlordPortalLesseeAccountViewRow = {
  lesseeId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  portalStatus: "active" | "disabled" | "pending_invite" | "no_account";
  inviteExpiresAt: string | null;
  leaseId: string | null;
  canResendInvite: boolean;
  canDeactivate: boolean;
  canReactivate: boolean;
  canResetPassword: boolean;
};

type LandlordPortalLesseeAccountsProps = {
  initialRows: LandlordPortalLesseeAccountViewRow[];
  fetchError: string | null;
  /** platform_only landlords get mutation actions; davors_managed is view-only. */
  canManageAccounts: boolean;
};

function formatPortalStatus(
  status: LandlordPortalLesseeAccountViewRow["portalStatus"],
): string {
  if (status === "active") return "Active";
  if (status === "disabled") return "Deactivated";
  if (status === "pending_invite") return "Pending invite";
  return "No portal account";
}

function formatInviteExpiry(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function deactivateConfirmMessage(displayName: string) {
  return `Deactivate portal access for ${displayName}? They will no longer be able to sign in. The tenant record and history are kept — you can reactivate later.`;
}

export default function LandlordPortalLesseeAccounts({
  initialRows,
  fetchError,
  canManageAccounts,
}: LandlordPortalLesseeAccountsProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  async function handleResendInvite(row: LandlordPortalLesseeAccountViewRow) {
    setError(null);
    setSuccess(null);
    setActionId(row.lesseeId);

    const response = await fetch(
      "/api/landlord-portal/lessee-accounts/resend-invite",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessee_id: row.lesseeId }),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      ok?: boolean;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to send invite.");
      setActionId(null);
      return;
    }

    setSuccess(`Invite sent to ${row.email ?? row.fullName}.`);
    setActionId(null);
    router.refresh();
  }

  async function handleDeactivate(row: LandlordPortalLesseeAccountViewRow) {
    if (!window.confirm(deactivateConfirmMessage(row.fullName))) {
      return;
    }

    setError(null);
    setSuccess(null);
    setActionId(row.lesseeId);

    const response = await fetch(
      "/api/landlord-portal/lessee-accounts/deactivate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessee_id: row.lesseeId }),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Failed to deactivate portal access.");
      setActionId(null);
      return;
    }

    setSuccess(`Portal access deactivated for ${row.fullName}.`);
    setActionId(null);
    setResettingId(null);
    router.refresh();
  }

  async function handleReactivate(row: LandlordPortalLesseeAccountViewRow) {
    setError(null);
    setSuccess(null);
    setActionId(row.lesseeId);

    const response = await fetch(
      "/api/landlord-portal/lessee-accounts/reactivate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessee_id: row.lesseeId }),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Failed to reactivate portal access.");
      setActionId(null);
      return;
    }

    setSuccess(`Portal access restored for ${row.fullName}.`);
    setActionId(null);
    router.refresh();
  }

  async function handleResetPassword(
    e: React.FormEvent,
    row: LandlordPortalLesseeAccountViewRow,
  ) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setActionId(row.lesseeId);

    const response = await fetch(
      "/api/landlord-portal/lessee-accounts/reset-password",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessee_id: row.lesseeId,
          password: resetPassword,
        }),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Failed to reset password.");
      setActionId(null);
      return;
    }

    setSuccess(`Password updated for ${row.fullName}.`);
    setResetPassword("");
    setResettingId(null);
    setActionId(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">No lessees found yet.</p>
      ) : (
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Name</th>
                <th className={scrollableTableThClassName}>Email</th>
                <th className={scrollableTableThClassName}>Portal status</th>
                <th className={scrollableTableThClassName}>Invite expires</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row, index) => (
                <tr key={row.lesseeId} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.leaseId ? (
                      <Link
                        href={`/landlord-portal/real-estate/leases/${row.leaseId}`}
                        className="text-[#0f2744] underline-offset-2 hover:underline"
                      >
                        {row.fullName}
                      </Link>
                    ) : (
                      row.fullName
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.email ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatPortalStatus(row.portalStatus)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatInviteExpiry(row.inviteExpiresAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <div className="inline-flex flex-wrap items-center gap-1.5">
                        {row.canResendInvite ? (
                          <button
                            type="button"
                            className={portalSecondaryButtonClassName}
                            disabled={actionId !== null}
                            onClick={() => handleResendInvite(row)}
                          >
                            {actionId === row.lesseeId
                              ? "Sending…"
                              : row.portalStatus === "pending_invite"
                                ? "Resend invite"
                                : "Send invite"}
                          </button>
                        ) : null}

                        {canManageAccounts && row.canResetPassword ? (
                          <button
                            type="button"
                            className={portalSecondaryButtonClassName}
                            disabled={actionId !== null}
                            onClick={() => {
                              setResettingId(
                                resettingId === row.lesseeId
                                  ? null
                                  : row.lesseeId,
                              );
                              setResetPassword("");
                              setError(null);
                              setSuccess(null);
                            }}
                          >
                            Reset password
                          </button>
                        ) : null}

                        {canManageAccounts && row.canDeactivate ? (
                          <button
                            type="button"
                            className={portalDangerButtonClassName}
                            disabled={actionId !== null}
                            onClick={() => handleDeactivate(row)}
                          >
                            {actionId === row.lesseeId
                              ? "Working…"
                              : "Deactivate"}
                          </button>
                        ) : null}

                        {canManageAccounts && row.canReactivate ? (
                          <button
                            type="button"
                            className={portalSecondaryButtonClassName}
                            disabled={actionId !== null}
                            onClick={() => handleReactivate(row)}
                          >
                            {actionId === row.lesseeId
                              ? "Working…"
                              : "Reactivate"}
                          </button>
                        ) : null}

                        {!row.canResendInvite &&
                        !row.canDeactivate &&
                        !row.canReactivate &&
                        !row.canResetPassword ? (
                          row.portalStatus === "active" ||
                          row.portalStatus === "disabled" ? (
                            canManageAccounts ? null : (
                              <span className="text-xs text-slate-500">
                                View only
                              </span>
                            )
                          ) : (
                            <span className="text-xs text-slate-500">
                              Add email on tenant record to invite
                            </span>
                          )
                        ) : null}
                      </div>

                      {canManageAccounts &&
                      resettingId === row.lesseeId &&
                      row.canResetPassword ? (
                        <form
                          onSubmit={(e) => handleResetPassword(e, row)}
                          className="flex max-w-sm flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
                        >
                          <label className="text-xs font-medium text-slate-700">
                            New password (min 8 characters)
                          </label>
                          <input
                            type="password"
                            required
                            minLength={8}
                            value={resetPassword}
                            onChange={(e) => setResetPassword(e.target.value)}
                            className={portalInputClassName}
                            autoComplete="new-password"
                          />
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              className={portalSecondaryButtonClassName}
                              disabled={actionId !== null}
                            >
                              {actionId === row.lesseeId
                                ? "Saving…"
                                : "Save password"}
                            </button>
                            <button
                              type="button"
                              className={portalSecondaryButtonClassName}
                              disabled={actionId !== null}
                              onClick={() => {
                                setResettingId(null);
                                setResetPassword("");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </div>
  );
}
