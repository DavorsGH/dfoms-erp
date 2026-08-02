"use client";

import { useEffect, useState } from "react";
import {
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
} from "../../portal-ui";

type Props = {
  unitId: string;
  propertyId: string;
  unitLabel: string;
};

function canUseWebShare(url: string, unitLabel: string): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return false;
  }
  const data: ShareData = {
    title: `Rental application — Unit ${unitLabel}`,
    text: `Apply for unit ${unitLabel}`,
    url,
  };
  if (typeof navigator.canShare === "function") {
    try {
      return navigator.canShare(data);
    } catch {
      return false;
    }
  }
  return true;
}

export default function ShareApplyLinkButton({
  unitId,
  propertyId,
  unitLabel,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);

  useEffect(() => {
    if (!url) {
      setNativeShareAvailable(false);
      return;
    }
    setNativeShareAvailable(canUseWebShare(url, unitLabel));
  }, [url, unitLabel]);

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

  async function shareUrl() {
    if (!url || !canUseWebShare(url, unitLabel)) return;

    setSharing(true);
    setError(null);
    try {
      await navigator.share({
        title: `Rental application — Unit ${unitLabel}`,
        text: `Apply for unit ${unitLabel}`,
        url,
      });
    } catch (err) {
      // User dismissed the share sheet — not an error.
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setError("Sharing failed. You can still copy the link.");
    } finally {
      setSharing(false);
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void copyUrl()}
            className={portalPrimaryButtonClassName}
            title={url}
          >
            {copied ? "Copied" : `Copy link (${unitLabel})`}
          </button>
          {nativeShareAvailable ? (
            <button
              type="button"
              disabled={sharing}
              onClick={() => void shareUrl()}
              className={portalSecondaryButtonClassName}
            >
              {sharing ? "Sharing…" : "Share"}
            </button>
          ) : null}
        </div>
      )}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
