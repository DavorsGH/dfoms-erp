"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import { TenantLogosMediaImage } from "@/components/tenant-logos-media";
import { DEFAULT_WORKSPACE_LOGO } from "@/utils/tenant-branding-types";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

type WorkspaceFormProps = {
  tenantId: string;
  initialName: string;
  initialEmail: string | null;
  initialPhone: string | null;
  initialAddress: string | null;
  initialLogoUrl: string | null;
};

export default function LandlordPortalWorkspaceForm({
  tenantId,
  initialName,
  initialEmail,
  initialPhone,
  initialAddress,
  initialLogoUrl,
}: WorkspaceFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [address, setAddress] = useState(initialAddress ?? "");
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [loading, setLoading] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
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

  async function handleLogoUpload(file: File) {
    setUploadingLogo(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("file", file);

    const response = await fetch("/api/landlord-portal/workspace/upload-logo", {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      logo_url?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to upload logo.");
      setUploadingLogo(false);
      return;
    }

    if (payload?.logo_url) {
      setLogoUrl(payload.logo_url);
    }
    setSuccess("Workspace logo updated.");
    setUploadingLogo(false);
    router.refresh();
  }

  const previewLogoUrl = logoUrl?.trim() || DEFAULT_WORKSPACE_LOGO;
  const usesStorageLogo = Boolean(logoUrl?.trim());

  return (
    <div className="mt-4 space-y-6">
      <form onSubmit={handleSubmit} className="space-y-3">
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

      <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium text-slate-700">Workspace logo</p>
          <p className="mt-1 text-xs text-slate-500">
            Shown in the Landlord Portal header next to your name. JPEG, PNG, or
            WebP.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {usesStorageLogo ? (
            <TenantLogosMediaImage
              reference={logoUrl!}
              tenantId={tenantId}
              alt="Workspace logo preview"
              className="h-20 w-20 shrink-0 rounded-full border border-slate-200 object-cover bg-white"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewLogoUrl}
              alt="Workspace logo preview"
              className="h-20 w-20 shrink-0 rounded-full border border-slate-200 object-cover bg-white"
            />
          )}
          <ImageFileUploadButton
            files={[]}
            onChange={(next) => {
              const file = next[0];
              if (file) {
                void handleLogoUpload(file);
              }
            }}
            multiple={false}
            disabled={uploadingLogo}
            addLabel={uploadingLogo ? "Uploading…" : "Upload logo"}
            showClear={false}
            resetInputAfterSelect
          />
        </div>
      </section>
    </div>
  );
}
