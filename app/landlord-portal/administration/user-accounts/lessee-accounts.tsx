"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  portalErrorBannerClassName,
  portalSecondaryButtonClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

export type LandlordPortalLesseeAccountViewRow = {
  lesseeId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  portalStatus: "active" | "pending_invite" | "no_account";
  inviteExpiresAt: string | null;
  canResendInvite: boolean;
};

type LandlordPortalLesseeAccountsProps = {
  initialRows: LandlordPortalLesseeAccountViewRow[];
  fetchError: string | null;
};

function formatPortalStatus(
  status: LandlordPortalLesseeAccountViewRow["portalStatus"],
): string {
  if (status === "active") return "Active";
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

export default function LandlordPortalLesseeAccounts({
  initialRows,
  fetchError,
}: LandlordPortalLesseeAccountsProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

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
                    {row.fullName}
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
                    ) : row.portalStatus === "active" ? (
                      <span className="text-xs text-slate-500">—</span>
                    ) : (
                      <span className="text-xs text-slate-500">
                        Add email on tenant record to invite
                      </span>
                    )}
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
