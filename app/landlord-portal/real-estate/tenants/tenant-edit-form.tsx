"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LandlordPortalLesseeDetail } from "@/utils/landlord-portal-auth";
import { fetchLesseeEmailDuplicateWarning } from "@/utils/lessee-email-duplicate";
import {
  formatLesseePortalAccessState,
  type LesseePortalAccessState,
} from "@/utils/lessee-portal-access";
import {
  portalDangerButtonClassName,
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

type TenantEditFormProps = {
  detail: LandlordPortalLesseeDetail;
  canEdit: boolean;
};

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

function revokeConfirmMessage(displayName: string) {
  return `Revoke portal access for ${displayName}? They will no longer be able to sign in. Their login email can later be invited by another landlord.`;
}

export default function LandlordPortalTenantEditForm({
  detail,
  canEdit,
}: TenantEditFormProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState(detail.fullName);
  const [phone, setPhone] = useState(detail.phone ?? "");
  const [email, setEmail] = useState(detail.email ?? "");
  const [loading, setLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [portalAccessState, setPortalAccessState] =
    useState<LesseePortalAccessState>(detail.portalAccessState);
  const [pendingInviteExpiresAt, setPendingInviteExpiresAt] = useState(
    detail.pendingInviteExpiresAt,
  );
  const [emailDuplicateWarning, setEmailDuplicateWarning] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setFullName(detail.fullName);
    setPhone(detail.phone ?? "");
    setEmail(detail.email ?? "");
    setPortalAccessState(detail.portalAccessState);
    setPendingInviteExpiresAt(detail.pendingInviteExpiresAt);
  }, [detail]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const duplicateWarning = await fetchLesseeEmailDuplicateWarning(
      "landlord-portal",
      {
        email: email.trim() || "",
        lessee_id: detail.lesseeId,
      },
    );
    setEmailDuplicateWarning(duplicateWarning);

    const response = await fetch("/api/landlord-portal/lessees/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lessee_id: detail.lesseeId,
        full_name: fullName,
        phone,
        email: email.trim() || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save tenant details.");
      setLoading(false);
      return;
    }

    setSuccess("Tenant details saved.");
    setLoading(false);
    router.refresh();
  }

  async function handlePortalInvite() {
    if (!canEdit) return;
    setPortalLoading(true);
    setError(null);
    setSuccess(null);

    const inviteEmail = email.trim() || detail.email?.trim() || "";
    const duplicateWarning = await fetchLesseeEmailDuplicateWarning(
      "landlord-portal",
      {
        email: inviteEmail,
        lessee_id: detail.lesseeId,
      },
    );
    setEmailDuplicateWarning(duplicateWarning);

    const response = await fetch(
      "/api/landlord-portal/lessee-accounts/resend-invite",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessee_id: detail.lesseeId }),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to send portal invite.");
      setPortalLoading(false);
      return;
    }

    setSuccess(
      portalAccessState === "invited"
        ? "Portal invite resent."
        : "Portal invite sent.",
    );
    setPortalAccessState("invited");
    setPortalLoading(false);
    router.refresh();
  }

  async function handleRevokePortal() {
    if (!canEdit) return;
    if (!window.confirm(revokeConfirmMessage(detail.fullName))) {
      return;
    }

    setPortalLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch(
      "/api/landlord-portal/lessee-accounts/revoke",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessee_id: detail.lesseeId }),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to revoke portal access.");
      setPortalLoading(false);
      return;
    }

    setSuccess("Portal access revoked.");
    setPortalAccessState("former");
    setPendingInviteExpiresAt(null);
    setPortalLoading(false);
    router.refresh();
  }

  const canSendInvite =
    canEdit &&
    (portalAccessState === "not_invited" ||
      portalAccessState === "former" ||
      portalAccessState === "invited") &&
    Boolean((email || detail.email)?.trim());
  const inviteLabel =
    portalAccessState === "invited" ? "Resend invite" : "Send portal invite";
  const canRevoke = canEdit && portalAccessState === "active";

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {portalAccessState === "active" ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This tenant has an active portal account. Email changes here update
          contact and invite records only — not the portal login email.
        </div>
      ) : null}

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Portal Access</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Status</dt>
            <dd className="font-medium text-[#0f2744]">
              {formatLesseePortalAccessState(portalAccessState)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Invite expires</dt>
            <dd className="font-medium text-slate-900">
              {portalAccessState === "invited"
                ? formatInviteExpiry(pendingInviteExpiresAt)
                : "—"}
            </dd>
          </div>
        </dl>
        {!canEdit ? (
          <p className="mt-3 text-sm text-slate-600">
            Portal login is managed by Davors staff for this workspace.
          </p>
        ) : null}
        {canEdit &&
        !(email || detail.email)?.trim() &&
        (portalAccessState === "not_invited" ||
          portalAccessState === "former") ? (
          <p className="mt-3 text-sm text-amber-800">
            Add an email before sending a portal invite.
          </p>
        ) : null}
        {emailDuplicateWarning ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {emailDuplicateWarning}
          </p>
        ) : null}
        {canEdit ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {canSendInvite ? (
              <button
                type="button"
                disabled={portalLoading || loading}
                onClick={handlePortalInvite}
                className={portalPrimaryButtonClassName}
              >
                {portalLoading ? "Working…" : inviteLabel}
              </button>
            ) : null}
            {canRevoke ? (
              <button
                type="button"
                disabled={portalLoading || loading}
                onClick={handleRevokePortal}
                className={portalDangerButtonClassName}
              >
                {portalLoading ? "Working…" : "Revoke portal access"}
              </button>
            ) : null}
            {!canSendInvite && !canRevoke ? (
              <span className="text-sm text-slate-500">No portal actions.</span>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Contact details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={portalLabelClassName} htmlFor="tenant-full-name">
              Full name
            </label>
            <input
              id="tenant-full-name"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              disabled={!canEdit || loading}
              required
              className={portalInputClassName}
            />
          </div>
          <div>
            <label className={portalLabelClassName} htmlFor="tenant-phone">
              Phone
            </label>
            <input
              id="tenant-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={!canEdit || loading}
              required
              className={portalInputClassName}
            />
          </div>
          <div>
            <label className={portalLabelClassName} htmlFor="tenant-email">
              Email
            </label>
            <input
              id="tenant-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmailDuplicateWarning(null);
                setEmail(event.target.value);
              }}
              disabled={!canEdit || loading}
              className={portalInputClassName}
            />
          </div>
        </div>
      </section>

      {canEdit ? (
        <button
          type="submit"
          disabled={loading || portalLoading}
          className={portalSecondaryButtonClassName}
        >
          {loading ? "Saving…" : "Save changes"}
        </button>
      ) : null}
    </form>
  );
}
