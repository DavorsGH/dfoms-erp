"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import { TenantLogosMediaImage } from "@/components/tenant-logos-media";
import { DEFAULT_WORKSPACE_LOGO } from "@/utils/tenant-branding-types";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
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
  landlordType: LandlordType | null;
  initialSignatureUrl: string | null;
  initialSignatureAuthorName: string | null;
  initialSignatureAuthorTitle: string | null;
};

export default function LandlordPortalWorkspaceForm({
  tenantId,
  initialName,
  initialEmail,
  initialPhone,
  initialAddress,
  initialLogoUrl,
  landlordType,
  initialSignatureUrl,
  initialSignatureAuthorName,
  initialSignatureAuthorTitle,
}: WorkspaceFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [address, setAddress] = useState(initialAddress ?? "");
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [signatureUrl, setSignatureUrl] = useState(initialSignatureUrl);
  const [signatureAuthorName, setSignatureAuthorName] = useState(
    initialSignatureAuthorName ?? "",
  );
  const [signatureAuthorTitle, setSignatureAuthorTitle] = useState(
    initialSignatureAuthorTitle ?? "",
  );
  const [loading, setLoading] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [savingSignatureDetails, setSavingSignatureDetails] = useState(false);
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

  async function handleSignatureUpload(file: File) {
    setUploadingSignature(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("file", file);

    const response = await fetch("/api/landlord-portal/workspace/upload-signature", {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      signature_url?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to upload signature.");
      setUploadingSignature(false);
      return;
    }

    if (payload?.signature_url) {
      setSignatureUrl(payload.signature_url);
    }
    setSuccess("Authorized signature updated.");
    setUploadingSignature(false);
    router.refresh();
  }

  async function handleSignatureDetailsSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSavingSignatureDetails(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/landlord-portal/workspace/signature-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signature_author_name: signatureAuthorName.trim() || null,
        signature_author_title: signatureAuthorTitle.trim() || null,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save signature details.");
      setSavingSignatureDetails(false);
      return;
    }

    setSuccess("Signature author details saved.");
    setSavingSignatureDetails(false);
    router.refresh();
  }

  const previewLogoUrl = logoUrl?.trim() || DEFAULT_WORKSPACE_LOGO;
  const usesStorageLogo = Boolean(logoUrl?.trim());
  const usesStorageSignature = Boolean(signatureUrl?.trim());
  const showSignatureSettings = landlordType === "platform_only";

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

      {showSignatureSettings ? (
        <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
          <div>
            <p className="text-sm font-medium text-slate-700">Authorized signature</p>
            <p className="mt-1 text-xs text-slate-500">
              Used on rent receipts, deposit receipts, and tenancy agreement PDFs
              issued for your properties.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {usesStorageSignature ? (
              <TenantLogosMediaImage
                reference={signatureUrl!}
                tenantId={tenantId}
                alt="Signature preview"
                className="h-16 max-w-[200px] shrink-0 rounded-sm border border-slate-200 object-contain bg-white p-1"
              />
            ) : (
              <div className="flex h-16 w-[200px] shrink-0 items-center justify-center rounded-sm border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                No signature uploaded
              </div>
            )}
            <ImageFileUploadButton
              files={[]}
              onChange={(next) => {
                const file = next[0];
                if (file) {
                  void handleSignatureUpload(file);
                }
              }}
              multiple={false}
              disabled={uploadingSignature}
              addLabel={uploadingSignature ? "Uploading…" : "Upload signature"}
              showClear={false}
              resetInputAfterSelect
            />
          </div>
          <form
            onSubmit={(event) => void handleSignatureDetailsSubmit(event)}
            className="space-y-3 border-t border-slate-100 pt-4"
          >
            <div>
              <label htmlFor="signature_author_name" className={portalLabelClassName}>
                Signature name
              </label>
              <input
                id="signature_author_name"
                className={portalInputClassName}
                value={signatureAuthorName}
                onChange={(event) => setSignatureAuthorName(event.target.value)}
                disabled={savingSignatureDetails}
                placeholder="Printed name on PDFs"
              />
            </div>
            <div>
              <label htmlFor="signature_author_title" className={portalLabelClassName}>
                Signature title
              </label>
              <input
                id="signature_author_title"
                className={portalInputClassName}
                value={signatureAuthorTitle}
                onChange={(event) => setSignatureAuthorTitle(event.target.value)}
                disabled={savingSignatureDetails}
                placeholder="e.g. Property Manager"
              />
            </div>
            <button
              type="submit"
              className={portalPrimaryButtonClassName}
              disabled={savingSignatureDetails}
            >
              {savingSignatureDetails ? "Saving…" : "Save signature details"}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
