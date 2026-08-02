"use client";

import { useState } from "react";
import {
  portalAuthPrimaryButtonClassName,
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalSuccessBannerClassName,
  portalTextareaClassName,
} from "@/app/portal/portal-ui";

type ApplyFormProps = {
  token: string;
  propertyName: string;
  unitNumber: string;
  baseRentGhs: number;
  accepting: boolean;
  loadError: string | null;
};

export default function ApplyForm({
  token,
  propertyName,
  unitNumber,
  baseRentGhs,
  accepting,
  loadError,
}: ApplyFormProps) {
  const [error, setError] = useState<string | null>(loadError);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [idUrls, setIdUrls] = useState<string[]>([]);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    national_id: "",
    desired_move_in: "",
    household_size: "1",
    has_pets: false,
    pet_details: "",
    employer_name: "",
    job_title: "",
    monthly_income_ghs: "",
    employment_notes: "",
    references_text: "",
    consent_accuracy: false,
    consent_background_check: false,
  });

  async function handleUpload(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(`/api/apply/${encodeURIComponent(token)}/upload-id`, {
      method: "POST",
      body,
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      url?: string;
    } | null;
    setUploading(false);
    if (!response.ok || !payload?.url) {
      setError(payload?.error ?? "Unable to upload ID document.");
      return;
    }
    setIdUrls((current) => [...current, payload.url!]);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch(`/api/apply/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        household_size: form.household_size || null,
        monthly_income_ghs: form.monthly_income_ghs || null,
        id_document_urls: idUrls,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    setLoading(false);

    if (!response.ok) {
      setError(payload?.error ?? "Unable to submit application.");
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return (
      <div className={portalSuccessBannerClassName}>
        Application submitted. The landlord will review your packet and contact
        you if needed.
      </div>
    );
  }

  if (loadError || !accepting) {
    return (
      <div className={portalErrorBannerClassName}>
        {loadError ??
          "This unit is not currently accepting applications."}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        Applying for{" "}
        <span className="font-medium text-[#0f2744]">{propertyName}</span>
        {" · "}Unit {unitNumber}
        {baseRentGhs > 0 ? (
          <>
            {" · "}Listed rent GHS{" "}
            {baseRentGhs.toLocaleString("en-GH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </>
        ) : null}
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
          Identity
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={portalLabelClassName}>Full name *</label>
            <input
              required
              className={portalInputClassName}
              value={form.full_name}
              onChange={(e) =>
                setForm((c) => ({ ...c, full_name: e.target.value }))
              }
            />
          </div>
          <div>
            <label className={portalLabelClassName}>Phone *</label>
            <input
              required
              className={portalInputClassName}
              value={form.phone}
              onChange={(e) =>
                setForm((c) => ({ ...c, phone: e.target.value }))
              }
            />
          </div>
          <div>
            <label className={portalLabelClassName}>Email</label>
            <input
              type="email"
              className={portalInputClassName}
              value={form.email}
              onChange={(e) =>
                setForm((c) => ({ ...c, email: e.target.value }))
              }
            />
          </div>
          <div>
            <label className={portalLabelClassName}>National ID / Ghana Card</label>
            <input
              className={portalInputClassName}
              value={form.national_id}
              onChange={(e) =>
                setForm((c) => ({ ...c, national_id: e.target.value }))
              }
            />
          </div>
          <div>
            <label className={portalLabelClassName}>Desired move-in</label>
            <input
              type="date"
              className={portalInputClassName}
              value={form.desired_move_in}
              onChange={(e) =>
                setForm((c) => ({ ...c, desired_move_in: e.target.value }))
              }
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
          Household & pets
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={portalLabelClassName}>Household size</label>
            <input
              type="number"
              min={1}
              className={portalInputClassName}
              value={form.household_size}
              onChange={(e) =>
                setForm((c) => ({ ...c, household_size: e.target.value }))
              }
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.has_pets}
                onChange={(e) =>
                  setForm((c) => ({ ...c, has_pets: e.target.checked }))
                }
              />
              Has pets
            </label>
          </div>
          {form.has_pets ? (
            <div className="sm:col-span-2">
              <label className={portalLabelClassName}>Pet details</label>
              <textarea
                rows={2}
                className={portalTextareaClassName}
                value={form.pet_details}
                onChange={(e) =>
                  setForm((c) => ({ ...c, pet_details: e.target.value }))
                }
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
          Income & employment
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={portalLabelClassName}>Employer</label>
            <input
              className={portalInputClassName}
              value={form.employer_name}
              onChange={(e) =>
                setForm((c) => ({ ...c, employer_name: e.target.value }))
              }
            />
          </div>
          <div>
            <label className={portalLabelClassName}>Job title</label>
            <input
              className={portalInputClassName}
              value={form.job_title}
              onChange={(e) =>
                setForm((c) => ({ ...c, job_title: e.target.value }))
              }
            />
          </div>
          <div>
            <label className={portalLabelClassName}>Monthly income (GHS)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className={portalInputClassName}
              value={form.monthly_income_ghs}
              onChange={(e) =>
                setForm((c) => ({ ...c, monthly_income_ghs: e.target.value }))
              }
            />
          </div>
          <div className="sm:col-span-2">
            <label className={portalLabelClassName}>Employment notes</label>
            <textarea
              rows={2}
              className={portalTextareaClassName}
              value={form.employment_notes}
              onChange={(e) =>
                setForm((c) => ({ ...c, employment_notes: e.target.value }))
              }
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
          References
        </h2>
        <textarea
          rows={3}
          className={portalTextareaClassName}
          placeholder="Name, relationship, phone for each reference"
          value={form.references_text}
          onChange={(e) =>
            setForm((c) => ({ ...c, references_text: e.target.value }))
          }
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
          ID document (optional)
        </h2>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading}
          onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-slate-600"
        />
        {idUrls.length > 0 ? (
          <ul className="text-xs text-slate-600">
            {idUrls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#0f2744] underline"
                >
                  Uploaded document
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            required
            checked={form.consent_accuracy}
            onChange={(e) =>
              setForm((c) => ({ ...c, consent_accuracy: e.target.checked }))
            }
            className="mt-1"
          />
          I confirm the information provided is accurate. *
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            required
            checked={form.consent_background_check}
            onChange={(e) =>
              setForm((c) => ({
                ...c,
                consent_background_check: e.target.checked,
              }))
            }
            className="mt-1"
          />
          I consent to tenant screening / background checks as allowed by law. *
        </label>
      </section>

      <button
        type="submit"
        disabled={loading || uploading}
        className={portalAuthPrimaryButtonClassName}
      >
        {loading ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
