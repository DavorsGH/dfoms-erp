"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { DEFAULT_WORKSPACE_LOGO } from "@/utils/tenant-branding-types";
import { uploadTenantLogo } from "@/utils/tenant-logo";

type WorkspaceSettingsProps = {
  tenantId: string;
  initialName: string;
  initialLogoUrl: string | null;
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
  initialAddress,
  initialPhone,
  initialEmail,
  fetchError,
}: WorkspaceSettingsProps) {
  const router = useRouter();
  const supabase = createClient();
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [workspaceName, setWorkspaceName] = useState(initialName);
  const [workspaceAddress, setWorkspaceAddress] = useState(initialAddress ?? "");
  const [workspacePhone, setWorkspacePhone] = useState(initialPhone ?? "");
  const [workspaceEmail, setWorkspaceEmail] = useState(initialEmail ?? "");
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

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

  async function handleLogoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setUploadingLogo(true);
    setError(null);
    setSuccess(null);

    const uploadResult = await uploadTenantLogo(supabase, tenantId, file);

    if ("error" in uploadResult) {
      setError(uploadResult.error);
      setUploadingLogo(false);
      return;
    }

    const nextLogoUrl = uploadResult.publicUrl;

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

  const previewLogoUrl = logoUrl?.trim() || DEFAULT_WORKSPACE_LOGO;

  return (
    <div className="max-w-lg space-y-8">
      <p className="text-sm text-slate-600">
        Customize how your workspace appears in the sidebar, reports, payslips,
        and other printed documents.
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
            Phone
          </label>
          <input
            id="workspace_phone"
            type="text"
            value={workspacePhone}
            onChange={(event) => setWorkspacePhone(event.target.value)}
            className={inputClassName}
          />
        </div>
        <div>
          <label
            htmlFor="workspace_email"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Email
          </label>
          <input
            id="workspace_email"
            type="email"
            value={workspaceEmail}
            onChange={(event) => setWorkspaceEmail(event.target.value)}
            className={inputClassName}
          />
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
            JPEG, PNG, or WebP. Shown in the sidebar and on company documents.
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewLogoUrl}
            alt="Workspace logo preview"
            className="h-20 w-20 shrink-0 rounded-sm border border-slate-200 object-cover bg-white"
          />
          <div className="space-y-2">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleLogoUpload}
            />
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploadingLogo ? "Uploading…" : "Upload logo"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
