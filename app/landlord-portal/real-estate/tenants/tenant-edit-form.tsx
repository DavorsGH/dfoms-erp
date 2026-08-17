"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LandlordPortalLesseeDetail } from "@/utils/landlord-portal-auth";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

type TenantEditFormProps = {
  detail: LandlordPortalLesseeDetail;
  canEdit: boolean;
};

export default function LandlordPortalTenantEditForm({
  detail,
  canEdit,
}: TenantEditFormProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState(detail.fullName);
  const [phone, setPhone] = useState(detail.phone ?? "");
  const [email, setEmail] = useState(detail.email ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

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

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {detail.hasPortalAccount ? (
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
              onChange={(event) => setEmail(event.target.value)}
              disabled={!canEdit || loading}
              className={portalInputClassName}
            />
          </div>
        </div>
      </section>

      {canEdit ? (
        <button
          type="submit"
          disabled={loading}
          className={portalPrimaryButtonClassName}
        >
          {loading ? "Saving…" : "Save changes"}
        </button>
      ) : null}
    </form>
  );
}
