"use client";

import { useEffect, useState } from "react";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import { formatInventoryQuantity } from "@/app/dashboard/inventory/inventory-utils";
import { POS_WALK_IN_CUSTOMER_LABEL } from "@/app/dashboard/pos/pos-utils";
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
  const customerLabel =
    payload?.customerLabel?.trim() || POS_WALK_IN_CUSTOMER_LABEL;
  const servedByLabel = payload?.servedByLabel?.trim() || null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-6 border-b border-slate-800 px-6 py-4 sm:px-8">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded object-contain bg-white/5"
              />
            ) : null}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                {branding.displayName}
              </h1>
              {servedByLabel ? (
                <p className="mt-0.5 truncate text-xs text-slate-400 sm:text-sm">
                  Served by{" "}
                  <span className="font-medium text-slate-200">{servedByLabel}</span>
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Customer
          </p>
          <p className="max-w-[min(40vw,16rem)] truncate text-lg font-bold text-white sm:max-w-xs sm:text-xl">
            {customerLabel}
          </p>
        </div>
      </header>

      {!hasCart ? (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 py-16 text-center">
          <p className="text-5xl font-light text-slate-200">Welcome</p>
          <p className="mt-4 max-w-lg text-xl text-slate-400">
            Your items will appear here as they are added at the register.
          </p>
        </main>
      ) : (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto px-6 py-4 sm:px-8">
            <div className="space-y-4">
              {payload?.cartLines.map((line) => (
                <div
                  key={line.id}
                  className="flex items-start justify-between gap-6 border-b border-slate-800 pb-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-2xl font-medium leading-snug">
                      {line.productName}
                    </p>
                    <p className="mt-1 text-lg text-slate-400">
                      {formatInventoryQuantity(line.quantity)} {line.unitOfMeasure}{" "}
                      × {formatGHS(line.unitPrice)}
                    </p>
                  </div>
                  <p className="shrink-0 text-2xl font-semibold">
                    {formatGHS(line.lineTotal)}
                  </p>
                </div>
              ))}
            </div>
          </main>

          <footer className="shrink-0 border-t border-slate-700 px-6 py-4 sm:px-8">
            <div className="space-y-3 text-xl">
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
              <div className="flex justify-between pt-2 text-3xl font-bold sm:text-4xl">
                <span>Amount due</span>
                <span>{formatGHS(payload?.amountDue ?? 0)}</span>
              </div>
              {payload?.paymentMethod === "Cash" &&
              payload.amountTendered != null &&
              payload.amountTendered > 0 ? (
                <>
                  <div className="flex justify-between pt-2 text-xl text-slate-200 sm:text-2xl">
                    <span>Amount Tendered</span>
                    <span>{formatGHS(payload.amountTendered)}</span>
                  </div>
                  <div className="flex justify-between pt-1 text-2xl font-bold text-emerald-300 sm:text-3xl">
                    <span>Change Due</span>
                    <span>{formatGHS(payload.changeDue ?? 0)}</span>
                  </div>
                </>
              ) : null}
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
