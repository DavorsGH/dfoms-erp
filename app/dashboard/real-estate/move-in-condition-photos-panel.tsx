"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import { TenantLogosMediaImage } from "@/components/tenant-logos-media";

type MoveInConditionPhotosPanelProps = {
  tenantId: string;
  leaseId: string;
  initialUrls: string[];
  uploadPath: string;
  readOnly?: boolean;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

export default function MoveInConditionPhotosPanel({
  tenantId,
  leaseId,
  initialUrls,
  uploadPath,
  readOnly = false,
}: MoveInConditionPhotosPanelProps) {
  const router = useRouter();
  const [urls, setUrls] = useState(initialUrls);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setUrls(initialUrls);
  }, [initialUrls]);

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly || files.length === 0) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const nextUrls = [...urls];
    for (const file of files) {
      const formData = new FormData();
      formData.set("tenant_id", tenantId);
      formData.set("lease_id", leaseId);
      formData.set("file", file);

      const response = await fetch(uploadPath, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        storagePath?: string;
        photo_urls?: string[];
      } | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to upload photo.");
        setLoading(false);
        return;
      }

      if (payload?.photo_urls) {
        nextUrls.splice(0, nextUrls.length, ...payload.photo_urls);
      } else if (payload?.storagePath) {
        nextUrls.push(payload.storagePath);
      }
    }

    setUrls(nextUrls);
    setFiles([]);
    setSuccess("Move-in condition photos uploaded.");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {readOnly
          ? "Photos documenting the unit's condition when your lease started. These complement the Joint Inspection Sheet in your lease agreement."
          : "Document the unit's condition at lease move-in. These photos are separate from listing/marketing photos and appear in the tenant portal alongside the Joint Inspection Sheet in the lease PDF."}
      </p>

      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : null}
      {success ? (
        <p className="text-sm text-green-700">{success}</p>
      ) : null}

      {urls.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {urls.map((reference) => (
            <TenantLogosMediaImage
              key={reference}
              reference={reference}
              tenantId={tenantId}
              alt="Move-in condition"
              className="h-24 w-24 object-cover"
              linkable
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No move-in condition photos yet.</p>
      )}

      {!readOnly ? (
        <form onSubmit={handleUpload} className="space-y-3">
          <ImageFileUploadButton
            inputId={`move-in-photos-${leaseId}`}
            files={files}
            onChange={setFiles}
            multiple
          />
          <button
            type="submit"
            className={primaryButtonClassName}
            disabled={loading || files.length === 0}
          >
            {loading ? "Uploading…" : "Upload photos"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
