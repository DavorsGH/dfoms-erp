"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export type TaxSettingReviewField =
  | "sales_tax_basis_reviewed_at"
  | "product_sales_tax_rate_reviewed_at";

type TaxSettingReviewBannerProps = {
  tenantId: string;
  title: string;
  body: string;
  currentSettingLabel: string;
  reviewedAt: string | null;
  reviewField: TaxSettingReviewField;
  onGoToSettings?: () => void;
  settingsLinkLabel?: string;
};

const confirmButtonClassName =
  "shrink-0 rounded-md border border-amber-600 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50";

export default function TaxSettingReviewBanner({
  tenantId,
  title,
  body,
  currentSettingLabel,
  reviewedAt,
  reviewField,
  onGoToSettings,
  settingsLinkLabel = "Go to Settings",
}: TaxSettingReviewBannerProps) {
  const router = useRouter();
  const supabase = createClient();
  const [hidden, setHidden] = useState(Boolean(reviewedAt));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHidden(Boolean(reviewedAt));
  }, [reviewedAt]);

  if (hidden) {
    return null;
  }

  async function handleConfirm() {
    setConfirming(true);
    setError(null);

    const { error: saveError } = await supabase.from("tax_settings").upsert(
      {
        tenant_id: tenantId,
        [reviewField]: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );

    if (saveError) {
      setError(saveError.message);
      setConfirming(false);
      return;
    }

    setHidden(true);
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{title}</p>
          <p>{body}</p>
          <p>
            Current setting:{" "}
            <span className="font-medium">{currentSettingLabel}</span>
          </p>
          {onGoToSettings ? (
            <button
              type="button"
              onClick={onGoToSettings}
              className="font-medium text-[#0f2744] underline underline-offset-2 hover:text-[#18365c]"
            >
              {settingsLinkLabel}
            </button>
          ) : null}
          {error ? (
            <p className="text-red-700">{error}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={confirming}
          className={confirmButtonClassName}
        >
          {confirming ? "Confirming…" : "Confirm current setting"}
        </button>
      </div>
    </div>
  );
}
