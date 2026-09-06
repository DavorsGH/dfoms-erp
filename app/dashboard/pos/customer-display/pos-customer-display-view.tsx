"use client";

import { useEffect, useState } from "react";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import { formatInventoryQuantity } from "@/app/dashboard/inventory/inventory-utils";
import {
  subscribePosCustomerDisplay,
  type PosCustomerDisplayPayload,
} from "@/lib/pos-customer-display-channel";

type PosCustomerDisplayBranding = {
  displayName: string;
  logoUrl: string | null;
};

type PosCustomerDisplayViewProps = {
  channelName: string;
  branding: PosCustomerDisplayBranding;
};

export default function PosCustomerDisplayView({
  channelName,
  branding,
}: PosCustomerDisplayViewProps) {
  const [payload, setPayload] = useState<PosCustomerDisplayPayload | null>(null);

  useEffect(() => {
    return subscribePosCustomerDisplay(channelName, setPayload);
  }, [channelName]);

  const hasCart = (payload?.cartLines.length ?? 0) > 0;

  return (
    <div className="flex min-h-[70vh] flex-col bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-8 py-6 text-center">
        {branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt=""
            className="mx-auto mb-4 max-h-20 w-auto object-contain"
          />
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight">
          {branding.displayName}
        </h1>
      </header>

      {!hasCart ? (
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
          <p className="text-5xl font-light text-slate-200">Welcome</p>
          <p className="mt-4 max-w-lg text-xl text-slate-400">
            Your items will appear here as they are added at the register.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col px-8 py-8">
          {payload?.customerLabel ? (
            <p className="mb-6 text-center text-xl text-slate-300">
              Customer:{" "}
              <span className="font-medium text-white">{payload.customerLabel}</span>
            </p>
          ) : null}

          <div className="flex-1 space-y-4">
            {payload?.cartLines.map((line) => (
              <div
                key={line.id}
                className="flex items-start justify-between gap-6 border-b border-slate-800 pb-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-medium leading-snug">{line.productName}</p>
                  <p className="mt-1 text-lg text-slate-400">
                    {formatInventoryQuantity(line.quantity)} {line.unitOfMeasure} ×{" "}
                    {formatGHS(line.unitPrice)}
                  </p>
                </div>
                <p className="shrink-0 text-2xl font-semibold">
                  {formatGHS(line.lineTotal)}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-8 space-y-3 border-t border-slate-700 pt-6 text-xl">
            <div className="flex justify-between text-slate-300">
              <span>Subtotal</span>
              <span>{formatGHS(payload?.subtotal ?? 0)}</span>
            </div>
            {(payload?.promoDiscount ?? 0) > 0 ? (
              <div className="flex justify-between text-emerald-300">
                <span>
                  Promo{payload?.promoCode ? ` (${payload.promoCode})` : ""}
                </span>
                <span>-{formatGHS(payload?.promoDiscount ?? 0)}</span>
              </div>
            ) : null}
            {(payload?.loyaltyDiscount ?? 0) > 0 ? (
              <div className="flex justify-between text-emerald-300">
                <span>Loyalty</span>
                <span>-{formatGHS(payload?.loyaltyDiscount ?? 0)}</span>
              </div>
            ) : null}
            {(payload?.taxAmount ?? 0) > 0 ? (
              <div className="flex justify-between text-slate-300">
                <span>Tax</span>
                <span>{formatGHS(payload?.taxAmount ?? 0)}</span>
              </div>
            ) : null}
            <div className="flex justify-between pt-2 text-4xl font-bold">
              <span>Amount due</span>
              <span>{formatGHS(payload?.amountDue ?? 0)}</span>
            </div>
            {payload?.paymentMethod === "Cash" &&
            payload.cashTendered != null &&
            payload.cashTendered > 0 ? (
              <>
                <div className="flex justify-between pt-4 text-2xl text-slate-200">
                  <span>Cash tendered</span>
                  <span>{formatGHS(payload.cashTendered)}</span>
                </div>
                <div className="flex justify-between pt-2 text-3xl font-bold text-emerald-300">
                  <span>Change due</span>
                  <span>{formatGHS(payload.changeDue ?? 0)}</span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
