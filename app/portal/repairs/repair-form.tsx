"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const textareaClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

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
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-base font-semibold text-[#0f2744]">
        Submit a repair request
      </h2>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Description
        </label>
        <textarea
          className={textareaClassName}
          rows={4}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe the issue…"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Photos (optional)
        </label>
        <input
          type="file"
          accept="image/*"
          multiple
          className="block w-full text-sm text-slate-700"
          onChange={(event) =>
            setPhotoFiles(Array.from(event.target.files ?? []))
          }
        />
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          className="mt-1"
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
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Proposed cost (GHS)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            required={selfFix}
            className={inputClassName}
            value={proposedCost}
            onChange={(event) => setProposedCost(event.target.value)}
          />
        </div>
      ) : null}

      <button
        type="submit"
        className={primaryButtonClassName}
        disabled={loading}
      >
        {loading ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}
