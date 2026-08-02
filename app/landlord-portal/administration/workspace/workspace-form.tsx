"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

type WorkspaceFormProps = {
  initialName: string;
  initialEmail: string | null;
  initialPhone: string | null;
  initialAddress: string | null;
};

export default function LandlordPortalWorkspaceForm({
  initialName,
  initialEmail,
  initialPhone,
  initialAddress,
}: WorkspaceFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [address, setAddress] = useState(initialAddress ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/landlord-portal/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        phone,
        address,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save workspace settings.");
      setLoading(false);
      return;
    }

    setSuccess("Workspace settings saved.");
    setLoading(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <div>
        <label htmlFor="workspace-name" className={portalLabelClassName}>
          Display name
        </label>
        <input
          id="workspace-name"
          className={portalInputClassName}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={loading}
          required
        />
      </div>
      <div>
        <label htmlFor="workspace-email" className={portalLabelClassName}>
          Email
        </label>
        <input
          id="workspace-email"
          type="email"
          className={portalInputClassName}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={loading}
        />
      </div>
      <div>
        <label htmlFor="workspace-phone" className={portalLabelClassName}>
          Phone
        </label>
        <input
          id="workspace-phone"
          type="tel"
          className={portalInputClassName}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          disabled={loading}
        />
      </div>
      <div>
        <label htmlFor="workspace-address" className={portalLabelClassName}>
          Address
        </label>
        <textarea
          id="workspace-address"
          className={portalInputClassName}
          rows={3}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          disabled={loading}
        />
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <button
        type="submit"
        className={portalPrimaryButtonClassName}
        disabled={loading}
      >
        {loading ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
