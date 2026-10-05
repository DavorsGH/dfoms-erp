"use client";

import { useId, useRef } from "react";
import { useDialogKeyboard } from "@/components/feedback/use-dialog-keyboard";
import { useFocusTrap } from "@/components/feedback/use-focus-trap";

export type CampaignSendPreviewStats = {
  customerCount: number;
  eligibleEmailCount: number;
  eligibleSmsCount: number;
  skippedOptedOutEmailCount: number;
  skippedOptedOutSmsCount: number;
  missingEmailCount: number;
  missingPhoneCount: number;
};

type CampaignSendConfirmDialogProps = {
  campaignName: string;
  preview: CampaignSendPreviewStats;
  onConfirm: () => void;
  onCancel: () => void;
  confirming?: boolean;
};

export default function CampaignSendConfirmDialog({
  campaignName,
  preview,
  onConfirm,
  onCancel,
  confirming = false,
}: CampaignSendConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(true, panelRef);
  useDialogKeyboard(true, {
    onPrimary: () => {
      if (!confirming) {
        onConfirm();
      }
    },
    onDismiss: onCancel,
    primaryButtonRef: confirmRef,
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-[#0f2744]">
          Send campaign?
        </h2>
        <p id={bodyId} className="mt-2 text-sm text-slate-600">
          You are about to send <span className="font-medium">{campaignName}</span>.
          Review the audience breakdown below. SMS credits are checked per message at
          send time; recipients without credits are recorded as skipped.
        </p>

        <dl className="mt-4 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Customers in audience</dt>
            <dd className="font-medium text-slate-900">{preview.customerCount}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Eligible email deliveries</dt>
            <dd className="font-medium text-slate-900">
              {preview.eligibleEmailCount}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Eligible SMS deliveries</dt>
            <dd className="font-medium text-slate-900">
              {preview.eligibleSmsCount}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Skipped — no email</dt>
            <dd className="font-medium text-slate-900">
              {preview.missingEmailCount}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Skipped — no valid phone</dt>
            <dd className="font-medium text-slate-900">
              {preview.missingPhoneCount}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Skipped — opted out (email)</dt>
            <dd className="font-medium text-slate-900">
              {preview.skippedOptedOutEmailCount}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Skipped — opted out (SMS)</dt>
            <dd className="font-medium text-slate-900">
              {preview.skippedOptedOutSmsCount}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-slate-500">
          Sends run in batches of up to 50. You may need to click Continue Sending
          until the campaign finishes.
        </p>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
          >
            {confirming ? "Sending…" : "Confirm send"}
          </button>
        </div>
      </div>
    </div>
  );
}
