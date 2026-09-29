"use client";

import DashboardButton from "@/components/dashboard-button";
import { formatGHS } from "../finance/income-register-utils";
import { formatInventoryQuantity } from "../inventory/inventory-utils";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import {
  getAvailableStockForProduct,
  lineSubtotal,
  type PosCartLine,
} from "./pos-utils";

const cartLineFieldClassName =
  "box-border rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

type PosCartLinesProps = {
  cartLines: PosCartLine[];
  products: FinishedProductRecord[];
  busy: boolean;
  onUpdateQuantity: (lineId: string, value: string) => void;
  onUpdateUnitPrice: (lineId: string, value: string) => void;
  onStepQuantity: (lineId: string, delta: number) => void;
  onRemoveLine: (lineId: string) => void;
  onClearCart: () => void;
  onHold: () => void;
  onOpenHeldCarts: () => void;
  heldCartCount: number;
  holdDisabled: boolean;
  holdTooltip?: string;
  heldListDisabled: boolean;
  heldListTooltip?: string;
  subtotal: number;
  promoDiscount: number;
  appliedPromoCode: string | null;
  loyaltyDiscount: number;
  loyaltyPointsRedeemed: number;
  payableTotal: number;
  formatLoyaltyPoints: (value: number) => string;
};

function TrashIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function PosCartLineItem({
  line,
  maxQty,
  busy,
  onUpdateQuantity,
  onUpdateUnitPrice,
  onStepQuantity,
  onRemoveLine,
}: {
  line: PosCartLine;
  maxQty: number;
  busy: boolean;
  onUpdateQuantity: (lineId: string, value: string) => void;
  onUpdateUnitPrice: (lineId: string, value: string) => void;
  onStepQuantity: (lineId: string, delta: number) => void;
  onRemoveLine: (lineId: string) => void;
}) {
  return (
    <li className="py-4">
      <div className="block w-full">
        <p className="font-medium leading-snug text-[#0f2744] break-words">
          {line.productCode} — {line.productName}
        </p>
        <p className="mt-1 text-xs text-slate-500 break-words">
          Max qty for this line: {formatInventoryQuantity(maxQty)} {line.unitOfMeasure}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`Decrease quantity for ${line.productName}`}
            disabled={busy}
            onClick={() => onStepQuantity(line.id, -1)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 text-lg font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            −
          </button>
          <input
            type="number"
            min={0.0001}
            step="0.0001"
            aria-label={`Quantity for ${line.productName}`}
            value={line.quantity}
            onChange={(event) => onUpdateQuantity(line.id, event.target.value)}
            className={`${cartLineFieldClassName} h-10 w-16 shrink-0 text-center`}
          />
          <button
            type="button"
            aria-label={`Increase quantity for ${line.productName}`}
            disabled={busy}
            onClick={() => onStepQuantity(line.id, 1)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 text-lg font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            +
          </button>
        </div>

        <label className="sr-only" htmlFor={`price-${line.id}`}>
          Unit price for {line.productName}
        </label>
        <input
          id={`price-${line.id}`}
          type="number"
          min={0}
          step="0.01"
          value={line.unitPrice}
          onChange={(event) => onUpdateUnitPrice(line.id, event.target.value)}
          className={`${cartLineFieldClassName} h-10 w-24 shrink-0`}
        />

        <span className="ml-auto shrink-0 whitespace-nowrap text-right font-medium text-[#0f2744]">
          {formatGHS(lineSubtotal(line))}
        </span>

        <DashboardButton
          variant="danger"
          icon={<TrashIcon />}
          tooltip="Remove line"
          aria-label={`Remove ${line.productName} from cart`}
          disabled={busy}
          onClick={() => onRemoveLine(line.id)}
          className="h-10 w-10 shrink-0 px-0"
        />
      </div>
    </li>
  );
}

export default function PosCartLines({
  cartLines,
  products,
  busy,
  onUpdateQuantity,
  onUpdateUnitPrice,
  onStepQuantity,
  onRemoveLine,
  onClearCart,
  onHold,
  onOpenHeldCarts,
  heldCartCount,
  holdDisabled,
  holdTooltip,
  heldListDisabled,
  heldListTooltip,
  subtotal,
  promoDiscount,
  appliedPromoCode,
  loyaltyDiscount,
  loyaltyPointsRedeemed,
  payableTotal,
  formatLoyaltyPoints,
}: PosCartLinesProps) {
  return (
    <section className="overflow-x-hidden rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#0f2744]">Cart</h2>
        <div className="flex flex-wrap gap-2">
          <DashboardButton
            variant="warning"
            disabled={holdDisabled || cartLines.length === 0 || busy}
            tooltip={holdTooltip}
            onClick={onHold}
          >
            Hold
          </DashboardButton>
          <DashboardButton
            variant="secondary"
            disabled={heldListDisabled || busy}
            tooltip={heldListTooltip}
            onClick={onOpenHeldCarts}
            className="relative"
          >
            Held carts
            {heldCartCount > 0 ? (
              <span className="ml-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[#0f2744] px-1.5 text-xs font-semibold text-white">
                {heldCartCount > 99 ? "99+" : heldCartCount}
              </span>
            ) : null}
          </DashboardButton>
          <DashboardButton
            variant="danger"
            disabled={cartLines.length === 0 || busy}
            onClick={onClearCart}
          >
            Clear cart
          </DashboardButton>
        </div>
      </div>

      {cartLines.length === 0 ? (
        <p className="text-sm text-slate-500">No items in cart yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-x-hidden">
          {cartLines.map((line) => {
            const product = products.find((item) => item.id === line.productId);
            const maxQty = product
              ? getAvailableStockForProduct(product, cartLines, line.id)
              : 0;

            return (
              <PosCartLineItem
                key={line.id}
                line={line}
                maxQty={maxQty}
                busy={busy}
                onUpdateQuantity={onUpdateQuantity}
                onUpdateUnitPrice={onUpdateUnitPrice}
                onStepQuantity={onStepQuantity}
                onRemoveLine={onRemoveLine}
              />
            );
          })}
        </ul>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="text-sm text-slate-700">
          Cart subtotal:{" "}
          <span className="font-semibold text-[#0f2744]">{formatGHS(subtotal)}</span>
        </p>
        {promoDiscount > 0 ? (
          <p className="mt-1 text-sm text-emerald-800">
            Promo discount ({appliedPromoCode}): -{formatGHS(promoDiscount)}
          </p>
        ) : null}
        {loyaltyDiscount > 0 ? (
          <p className="mt-1 text-sm text-emerald-800">
            Loyalty redemption ({formatLoyaltyPoints(loyaltyPointsRedeemed)} pts): -
            {formatGHS(loyaltyDiscount)}
          </p>
        ) : null}
        <p className="mt-2 text-sm text-slate-700">
          Amount due:{" "}
          <span className="text-lg font-semibold text-[#0f2744]">
            {formatGHS(payableTotal)}
          </span>
        </p>
      </div>
    </section>
  );
}
