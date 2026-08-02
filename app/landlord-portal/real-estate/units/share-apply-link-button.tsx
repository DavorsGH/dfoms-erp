"use client";

import { useState } from "react";
import {
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
} from "../../portal-ui";

type Props = {
  unitId: string;
  propertyId: string;
  unitLabel: string;
};

export default function ShareApplyLinkButton({
  unitId,
  propertyId,
  unitLabel,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function createLink() {
    setLoading(true);
    setError(null);
    setCopied(false);
    const response = await fetch(
      "/api/landlord-portal/applications/create-link",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit_id: unitId, property_id: propertyId }),
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      url?: string;
    } | null;
    setLoading(false);
    if (!response.ok || !payload?.url) {
      setError(payload?.error ?? "Unable to create apply link.");
      return;
    }
    setUrl(payload.url);
  }

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Could not copy. Select and copy the link manually.");
    }
  }

  return (
    <div className="space-y-1">
      {!url ? (
        <button
          type="button"
          disabled={loading}
          onClick={createLink}
          className={portalSecondaryButtonClassName}
        >
          {loading ? "Creating…" : "Share apply link"}
        </button>
      ) : (
        <div className="space-y-1">
          <p className="max-w-xs break-all text-xs text-slate-600" title={url}>
            {url}
          </p>
          <button
            type="button"
            onClick={copyUrl}
            className={portalPrimaryButtonClassName}
          >
            {copied ? "Copied" : `Copy link (${unitLabel})`}
          </button>
        </div>
      )}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
