"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import { TenantLogosMediaImage } from "@/components/tenant-logos-media";
import { DEFAULT_WORKSPACE_LOGO } from "@/utils/tenant-branding-types";
import { uploadTenantLogo } from "@/utils/tenant-logo";
import { uploadTenantSignature } from "@/utils/tenant-signature";

type WorkspaceSettingsProps = {
  tenantId: string;
  initialName: string;
  initialLogoUrl: string | null;
  initialSignatureUrl: string | null;
  initialSignatureAuthorName: string | null;
  initialSignatureAuthorTitle: string | null;
  initialAddress: string | null;
  initialPhone: string | null;
  initialEmail: string | null;
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function WorkspaceSettings({
  tenantId,
  initialName,
  initialLogoUrl,
  initialSignatureUrl,
  initialSignatureAuthorName,
  initialSignatureAuthorTitle,
  initialAddress,
  initialPhone,
  initialEmail,
  fetchError,
}: WorkspaceSettingsProps) {
  const router = useRouter();
  const supabase = createClient();

  const [workspaceName, setWorkspaceName] = useState(initialName);
  const [workspaceAddress, setWorkspaceAddress] = useState(initialAddress ?? "");
  const [workspacePhone, setWorkspacePhone] = useState(initialPhone ?? "");
  const [workspaceEmail, setWorkspaceEmail] = useState(initialEmail ?? "");
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [signatureUrl, setSignatureUrl] = useState(initialSignatureUrl);
  const [signatureAuthorName, setSignatureAuthorName] = useState(
    initialSignatureAuthorName ?? "",
  );
  const [signatureAuthorTitle, setSignatureAuthorTitle] = useState(
    initialSignatureAuthorTitle ?? "",
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [savingSignatureDetails, setSavingSignatureDetails] = useState(false);

  async function handleDetailsSubmit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedName = workspaceName.trim();
    if (!trimmedName) {
      setError("Workspace name is required.");
      return;
    }

    const trimmedEmail = workspaceEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    setSavingName(true);
    setError(null);
    setSuccess(null);

    const trimmedAddress = workspaceAddress.trim();
    const trimmedPhone = workspacePhone.trim();

    const { error: updateError } = await supabase
      .from("tenants")
      .update({
        name: trimmedName,
        address: trimmedAddress || null,
        phone: trimmedPhone || null,
        email: trimmedEmail || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenantId);

    if (updateError) {
      setError(updateError.message);
      setSavingName(false);
      return;
    }

    setWorkspaceName(trimmedName);
    setWorkspaceAddress(trimmedAddress);
    setWorkspacePhone(trimmedPhone);
    setWorkspaceEmail(trimmedEmail);
    setSuccess("Workspace details saved.");
    setSavingName(false);
    router.refresh();
  }

  async function handleLogoUpload(file: File) {
    setUploadingLogo(true);
    setError(null);
    setSuccess(null);

    const uploadResult = await uploadTenantLogo(supabase, tenantId, file);

    if ("error" in uploadResult) {
      setError(uploadResult.error);
      setUploadingLogo(false);
      return;
    }

    const nextLogoUrl = uploadResult.storagePath;

    const { error: updateError } = await supabase
      .from("tenants")
      .update({
        logo_url: nextLogoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenantId);

    if (updateError) {
      setError(updateError.message);
      setUploadingLogo(false);
      return;
    }

    setLogoUrl(nextLogoUrl);
    setSuccess("Workspace logo updated.");
    setUploadingLogo(false);
    router.refresh();
  }

  async function handleSignatureUpload(file: File) {
    setUploadingSignature(true);
    setError(null);
    setSuccess(null);

    const uploadResult = await uploadTenantSignature(supabase, tenantId, file);

    if ("error" in uploadResult) {
      setError(uploadResult.error);
      setUploadingSignature(false);
      return;
    }

    const nextSignatureUrl = uploadResult.storagePath;

    const { error: updateError } = await supabase
      .from("tenants")
      .update({
        signature_url: nextSignatureUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenantId);

    if (updateError) {
      setError(updateError.message);
      setUploadingSignature(false);
      return;
    }

    setSignatureUrl(nextSignatureUrl);
    setSuccess("Signature image updated.");
    setUploadingSignature(false);
    router.refresh();
  }

  async function handleSignatureDetailsSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSavingSignatureDetails(true);
    setError(null);
    setSuccess(null);

    const trimmedName = signatureAuthorName.trim();
    const trimmedTitle = signatureAuthorTitle.trim();

    const { error: updateError } = await supabase
      .from("tenants")
      .update({
        signature_author_name: trimmedName || null,
        signature_author_title: trimmedTitle || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenantId);

    if (updateError) {
      setError(updateError.message);
      setSavingSignatureDetails(false);
      return;
    }

    setSignatureAuthorName(trimmedName);
    setSignatureAuthorTitle(trimmedTitle);
    setSuccess("Signature author details saved.");
    setSavingSignatureDetails(false);
    router.refresh();
  }

  const previewLogoUrl = logoUrl?.trim() || DEFAULT_WORKSPACE_LOGO;
  const usesStorageLogo = Boolean(logoUrl?.trim());
  const usesStorageSignature = Boolean(signatureUrl?.trim());

  return (
    <div className="max-w-lg space-y-8">
      <p className="text-sm text-slate-600">
        Customize how your workspace appears in the sidebar, reports, payslips,
        and other printed documents. Phone and email are also used for Real
        Estate staff SMS and email alerts (Davors-managed properties and new
        landlord signups).
      </p>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {success}
        </p>
      ) : null}

      <form onSubmit={handleDetailsSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label
            htmlFor="workspace_name"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Workspace name
          </label>
          <input
            id="workspace_name"
            type="text"
            required
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            className={inputClassName}
          />
        </div>
        <div>
          <label
            htmlFor="workspace_address"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Address
          </label>
          <textarea
            id="workspace_address"
            rows={3}
            value={workspaceAddress}
            onChange={(event) => setWorkspaceAddress(event.target.value)}
            placeholder="Street, city, region"
            className={inputClassName}
          />
        </div>
        <div>
          <label
            htmlFor="workspace_phone"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Notification phone
          </label>
          <input
            id="workspace_phone"
            type="text"
            value={workspacePhone}
            onChange={(event) => setWorkspacePhone(event.target.value)}
            className={inputClassName}
            placeholder="e.g. 0241234567"
          />
          <p className="mt-1 text-xs text-slate-500">
            Ghana mobile number for Real Estate ops SMS alerts.
          </p>
        </div>
        <div>
          <label
            htmlFor="workspace_email"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Notification email
          </label>
          <input
            id="workspace_email"
            type="email"
            value={workspaceEmail}
            onChange={(event) => setWorkspaceEmail(event.target.value)}
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-slate-500">
            Email recipient for Real Estate ops alerts (same field as workspace
            contact email).
          </p>
        </div>
        <button
          type="submit"
          disabled={savingName}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savingName ? "Saving…" : "Save workspace details"}
        </button>
      </form>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-sm font-medium text-slate-700">Workspace logo</p>
          <p className="mt-1 text-xs text-slate-500">
            Shown in the sidebar and on company documents.
          </p>
        </div>

        <div className="flex items-center gap-4">
          {usesStorageLogo ? (
            <TenantLogosMediaImage
              reference={logoUrl!}
              tenantId={tenantId}
              alt="Workspace logo preview"
              className="h-20 w-20 shrink-0 rounded-sm border border-slate-200 object-cover bg-white"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewLogoUrl}
              alt="Workspace logo preview"
              className="h-20 w-20 shrink-0 rounded-sm border border-slate-200 object-cover bg-white"
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
            addLabel={uploadingLogo ? "Uploading…" : "Add photos"}
            showClear={false}
            resetInputAfterSelect
          />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-sm font-medium text-slate-700">Authorized signature</p>
          <p className="mt-1 text-xs text-slate-500">
            Used on customer invoice and payment receipt PDFs above the printed
            name and title.
          </p>
        </div>

        <div className="flex items-center gap-4">
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
          className="space-y-4 border-t border-slate-100 pt-4"
        >
          <div>
            <label
              htmlFor="signature_author_name"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Signature name (receipts)
            </label>
            <input
              id="signature_author_name"
              type="text"
              value={signatureAuthorName}
              onChange={(event) => setSignatureAuthorName(event.target.value)}
              className={inputClassName}
              placeholder="Printed name on payment receipts"
            />
          </div>
          <div>
            <label
              htmlFor="signature_author_title"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Signature title (receipts)
            </label>
            <input
              id="signature_author_title"
              type="text"
              value={signatureAuthorTitle}
              onChange={(event) => setSignatureAuthorTitle(event.target.value)}
              className={inputClassName}
              placeholder="e.g. Finance Manager"
            />
          </div>
          <button
            type="submit"
            disabled={savingSignatureDetails}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingSignatureDetails ? "Saving…" : "Save signature details"}
          </button>
        </form>
      </section>
    </div>
  );
}
