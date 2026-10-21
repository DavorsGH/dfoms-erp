"use client";

import Link from "next/link";
import {
  MOBILE_MONEY_NOT_SETUP_BODY,
  MOBILE_MONEY_NOT_SETUP_TITLE,
  PAYMENT_SETTINGS_HREF,
  canShowMobileMoneyPaymentSettingsHint,
} from "@/utils/product-sale-paystack";

export default function MobileMoneyNotSetupModal({
  viewerRole,
  onClose,
}: {
  viewerRole?: string | null;
  onClose: () => void;
}) {
  const showAdminHint = canShowMobileMoneyPaymentSettingsHint(viewerRole);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="momo-not-setup-title"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 text-center shadow-lg">
        <h2
          id="momo-not-setup-title"
          className="text-lg font-semibold text-[#0f2744]"
        >
          {MOBILE_MONEY_NOT_SETUP_TITLE}
        </h2>
        <p className="mt-3 text-sm text-slate-700">{MOBILE_MONEY_NOT_SETUP_BODY}</p>
        {showAdminHint ? (
          <p className="mt-2 text-sm text-slate-700">
            Connect it in{" "}
            <Link
              href={PAYMENT_SETTINGS_HREF}
              className="font-medium text-[#0f2744] underline"
              onClick={onClose}
            >
              Administration → Finance Settings → Online Payments
            </Link>
            .
          </p>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="mt-5 rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white"
          autoFocus
        >
          OK
        </button>
      </div>
    </div>
  );
}
