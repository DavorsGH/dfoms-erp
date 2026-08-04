"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";

type LandlordPortalMaintenanceCompletePanelProps = {
  requestId: string;
  status: string;
  landlordApprovalStatus: string;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

export default function LandlordPortalMaintenanceCompletePanel({
  requestId,
  status,
  landlordApprovalStatus,
}: LandlordPortalMaintenanceCompletePanelProps) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canComplete =
    status !== "completed" &&
    status !== "rejected" &&
    landlordApprovalStatus === "approved";
  const canAddPhotos = status === "completed";

  if (!canComplete && !canAddPhotos) {
    return null;
  }

  async function handleComplete() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/landlord-portal/maintenance/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to mark request completed.");
      setLoading(false);
      return;
    }

    if (files.length > 0) {
      for (const file of files) {
        const formData = new FormData();
        formData.set("request_id", requestId);
        formData.set("file", file);

        const uploadResponse = await fetch(
          "/api/landlord-portal/maintenance/upload-completion-photo",
          { method: "POST", body: formData },
        );
        const uploadPayload = (await uploadResponse.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!uploadResponse.ok) {
          setError(
            uploadPayload?.error ??
              "Marked completed, but after photo upload failed.",
          );
          setLoading(false);
          router.refresh();
          return;
        }
      }
      setFiles([]);
    }

    setSuccess("Request marked completed.");
    setLoading(false);
    router.refresh();
  }

  async function handleUploadPhotos(event: React.FormEvent) {
    event.preventDefault();
    if (files.length === 0) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    for (const file of files) {
      const formData = new FormData();
      formData.set("request_id", requestId);
      formData.set("file", file);

      const response = await fetch(
        "/api/landlord-portal/maintenance/upload-completion-photo",
        { method: "POST", body: formData },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setError(payload?.error ?? "Unable to upload after photo.");
        setLoading(false);
        return;
      }
    }

    setFiles([]);
    setSuccess("After photos uploaded.");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {success ? <p className="text-sm text-green-700">{success}</p> : null}

      {canComplete ? (
        <>
          <p className="text-sm text-slate-700">
            Mark this repair as completed and optionally attach after photos of
            the finished work.
          </p>
          <ImageFileUploadButton
            inputId={`landlord-completion-${requestId}`}
            files={files}
            onChange={setFiles}
            multiple
          />
          <button
            type="button"
            className={primaryButtonClassName}
            disabled={loading}
            onClick={handleComplete}
          >
            {loading ? "Saving…" : "Mark completed"}
          </button>
        </>
      ) : (
        <form onSubmit={handleUploadPhotos} className="space-y-3">
          <p className="text-sm text-slate-700">
            Add after photos showing the completed repair work.
          </p>
          <ImageFileUploadButton
            inputId={`landlord-completion-add-${requestId}`}
            files={files}
            onChange={setFiles}
            multiple
          />
          <button
            type="submit"
            className={primaryButtonClassName}
            disabled={loading || files.length === 0}
          >
            {loading ? "Uploading…" : "Upload after photos"}
          </button>
        </form>
      )}
    </div>
  );
}
