"use client";

import { useEffect, useState } from "react";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import {
  SERVICE_CONTRACT_DOCUMENT_ACCEPT,
  SERVICE_CONTRACT_DOCUMENT_HINT,
} from "@/utils/service-contract-document";
import {
  SERVICE_CONTRACT_DISPLAY_STEPS,
  SERVICE_CONTRACT_STATUSES,
  formatServiceContractDisplayStep,
  isServiceContractDocumentImage,
  resolveServiceContractDisplayStep,
  serviceContractDisplayStepBadgeClassName,
  type ServiceContractDisplayStepId,
  type ServiceContractStatus,
} from "@/utils/service-contracts-types";

const cardClassName =
  "space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

type ServiceContractRecordHeaderProps = {
  contractNumber: string;
  status: ServiceContractStatus;
  endDate: string;
  editable?: boolean;
  onStatusChange?: (status: ServiceContractStatus) => void;
};

export function ServiceContractRecordHeader({
  contractNumber,
  status,
  endDate,
  editable = false,
  onStatusChange,
}: ServiceContractRecordHeaderProps) {
  const [showStatusEditor, setShowStatusEditor] = useState(false);
  const displayStep = resolveServiceContractDisplayStep(status, endDate);
  const currentStepIndex = SERVICE_CONTRACT_DISPLAY_STEPS.findIndex(
    (step) => step.id === displayStep,
  );

  return (
    <section className={cardClassName}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Service Contract
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold text-[#0f2744]">{contractNumber}</h2>
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${serviceContractDisplayStepBadgeClassName(displayStep)}`}
            >
              {formatServiceContractDisplayStep(displayStep)}
            </span>
          </div>
          {editable && onStatusChange ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowStatusEditor((current) => !current)}
                className="text-sm font-medium text-[#0f2744] underline-offset-2 hover:underline"
              >
                {showStatusEditor ? "Hide status editor" : "Change status"}
              </button>
              {showStatusEditor ? (
                <select
                  value={status}
                  onChange={(event) =>
                    onStatusChange(event.target.value as ServiceContractStatus)
                  }
                  className={`${inputClassName} max-w-xs`}
                >
                  {SERVICE_CONTRACT_STATUSES.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry.charAt(0).toUpperCase() + entry.slice(1)}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}
        </div>

        <ol className="flex flex-wrap items-center gap-2 lg:max-w-xl lg:justify-end">
          {SERVICE_CONTRACT_DISPLAY_STEPS.map((step, index) => {
            const isComplete = index < currentStepIndex;
            const isCurrent = step.id === displayStep;

            return (
              <li key={step.id} className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                    isCurrent
                      ? serviceContractDisplayStepBadgeClassName(step.id)
                      : isComplete
                        ? "border-slate-200 bg-slate-50 text-slate-600"
                        : "border-slate-200 bg-white text-slate-400"
                  }`}
                >
                  {step.label}
                </span>
                {index < SERVICE_CONTRACT_DISPLAY_STEPS.length - 1 ? (
                  <span className="hidden text-slate-300 sm:inline" aria-hidden="true">
                    →
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

type ServiceContractDocumentPanelProps = {
  mode: "view" | "edit";
  documentUrl?: string | null;
  documentSignedUrl?: string | null;
  pendingFiles?: File[];
  onPendingFilesChange?: (files: File[]) => void;
  disabled?: boolean;
};

export function ServiceContractDocumentPanel({
  mode,
  documentUrl,
  documentSignedUrl,
  pendingFiles = [],
  onPendingFilesChange,
  disabled = false,
}: ServiceContractDocumentPanelProps) {
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingFiles[0]) {
      setPendingPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(pendingFiles[0]);
    setPendingPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [pendingFiles]);

  const previewUrl = pendingPreviewUrl ?? documentSignedUrl ?? null;
  const hasDocument = Boolean(documentUrl?.trim() || pendingFiles.length > 0);
  const isImage = pendingFiles[0]
    ? pendingFiles[0].type.startsWith("image/")
    : isServiceContractDocumentImage(documentUrl);

  return (
    <section className={cardClassName}>
      <div>
        <h3 className="text-sm font-medium text-slate-700">Contract Document</h3>
        <p className="mt-1 text-xs text-slate-500">
          Signed agreement or supporting document attached to this contract record.
        </p>
      </div>

      {hasDocument && previewUrl ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {isImage ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Contract document preview"
                className="h-40 w-auto max-w-full object-contain p-2"
              />
            </a>
          ) : (
            <div className="flex h-28 w-40 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-sm font-medium text-slate-600">
              PDF / Doc
            </div>
          )}
          <div className="space-y-2">
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
            >
              View document
            </a>
            {mode === "edit" && onPendingFilesChange ? (
              <p className="text-xs text-slate-500">{SERVICE_CONTRACT_DOCUMENT_HINT}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">No contract document uploaded yet.</p>
      )}

      {mode === "edit" && onPendingFilesChange ? (
        <ImageFileUploadButton
          files={pendingFiles}
          onChange={onPendingFilesChange}
          multiple={false}
          disabled={disabled}
          accept={SERVICE_CONTRACT_DOCUMENT_ACCEPT}
          emptyHint={SERVICE_CONTRACT_DOCUMENT_HINT}
          addLabel={hasDocument ? "Replace document" : "Upload document"}
          changeLabel="Replace document"
        />
      ) : null}
    </section>
  );
}

export function serviceContractPartiesCardClassName() {
  return cardClassName;
}

export { cardClassName as serviceContractCardClassName, inputClassName as serviceContractInputClassName };

export type { ServiceContractDisplayStepId };
