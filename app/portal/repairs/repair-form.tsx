"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";
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

export default function PortalRepairForm() {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [selfFix, setSelfFix] = useState(false);
  const [proposedCost, setProposedCost] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const createResponse = await fetch("/api/portal/maintenance/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          tenant_self_fix: selfFix,
          proposed_cost_ghs: selfFix ? proposedCost : null,
        }),
      });
      const createPayload = (await createResponse.json()) as {
        error?: string;
        request_id?: string;
      };
      if (!createResponse.ok || !createPayload.request_id) {
        throw new Error(createPayload.error ?? "Failed to submit repair request.");
      }

      for (const file of photoFiles) {
        const formData = new FormData();
        formData.set("request_id", createPayload.request_id);
        formData.set("file", file);
        const uploadResponse = await fetch(
          "/api/portal/maintenance/upload-photo",
          { method: "POST", body: formData },
        );
        const uploadPayload = (await uploadResponse.json()) as {
          error?: string;
        };
        if (!uploadResponse.ok) {
          throw new Error(
            uploadPayload.error ??
              "Request saved, but a photo failed to upload.",
          );
        }
      }

      setDescription("");
      setSelfFix(false);
      setProposedCost("");
      setPhotoFiles([]);
      setSuccess("Repair request submitted.");
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
      <h2 className={portalSectionTitleClassName}>Submit a repair request</h2>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <div>
        <label className={portalLabelClassName} htmlFor="repair-description">
          Description
        </label>
        <textarea
          id="repair-description"
          className={portalTextareaClassName}
          rows={4}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe the issue…"
        />
      </div>

      <div>
        <p className={portalLabelClassName}>Photos (optional)</p>
        <ImageFileUploadButton
          files={photoFiles}
          onChange={setPhotoFiles}
          multiple
        />
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          className="mt-1 cursor-pointer"
          checked={selfFix}
          onChange={(event) => setSelfFix(event.target.checked)}
        />
        <span>
          I&apos;d like to fix this myself (landlord must approve your proposed
          cost first; approved amount is credited against your next rent)
        </span>
      </label>

      {selfFix ? (
        <div>
          <label className={portalLabelClassName} htmlFor="repair-proposed-cost">
            Proposed cost (GHS)
          </label>
          <input
            id="repair-proposed-cost"
            type="number"
            min="0"
            step="0.01"
            required={selfFix}
            className={portalInputClassName}
            value={proposedCost}
            onChange={(event) => setProposedCost(event.target.value)}
          />
        </div>
      ) : null}

      <button
        type="submit"
        className={portalPrimaryButtonClassName}
        disabled={loading}
      >
        {loading ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}
