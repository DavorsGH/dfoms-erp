"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
  portalSuccessBannerClassName,
  portalTextareaClassName,
} from "../portal-ui";

export default function PortalComplaintForm() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/portal/complaints/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, description }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to submit complaint.");
      }
      setSubject("");
      setDescription("");
      setSuccess("Complaint submitted.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className={`${portalSectionClassName} space-y-4`}
    >
      <h2 className={portalSectionTitleClassName}>Submit a complaint</h2>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <div>
        <label className={portalLabelClassName} htmlFor="complaint-subject">
          Subject
        </label>
        <input
          id="complaint-subject"
          className={portalInputClassName}
          required
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>

      <div>
        <label className={portalLabelClassName} htmlFor="complaint-description">
          Description
        </label>
        <textarea
          id="complaint-description"
          className={portalTextareaClassName}
          rows={4}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <button
        type="submit"
        className={portalPrimaryButtonClassName}
        disabled={loading}
      >
        {loading ? "Submitting…" : "Submit complaint"}
      </button>
    </form>
  );
}
