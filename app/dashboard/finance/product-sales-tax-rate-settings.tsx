"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { TAX_SETTINGS_ON_CONFLICT } from "@/utils/phase5e-key-structure";
import {
  PRODUCT_SALES_TAX_RATE_OPTIONS,
  normalizeProductSalesTaxRate,
  type ProductSalesTaxRate,
} from "./tax-utils";
import { useStampBusinessUnitId } from "@/app/dashboard/business-unit-view-context";

type ProductSalesTaxRateSettingsProps = {
  tenantId: string;
  /** Active BU for upsert (null = default/All Businesses row). */
  activeBusinessUnitId?: string | null;
  initialProductSalesTaxRate: ProductSalesTaxRate;
  fetchError?: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#18365c] disabled:cursor-not-allowed disabled:opacity-50";

export default function ProductSalesTaxRateSettings({
  tenantId,
  activeBusinessUnitId = null,
  initialProductSalesTaxRate,
  fetchError = null,
}: ProductSalesTaxRateSettingsProps) {
  const router = useRouter();
  const supabase = createClient();
  const stampBusinessUnit = useStampBusinessUnitId();
  const [productSalesTaxRate, setProductSalesTaxRate] =
    useState<ProductSalesTaxRate>(initialProductSalesTaxRate);
  const [error, setError] = useState<string | null>(fetchError);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProductSalesTaxRate(initialProductSalesTaxRate);
  }, [initialProductSalesTaxRate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setInfoMessage(null);

    if (!stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      setSaving(false);
      return;
    }

    const { error: saveError } = await supabase.from("tax_settings").upsert(
      {
        tenant_id: tenantId,
        business_unit_id: stampBusinessUnit.businessUnitId,
        product_sales_tax_rate: productSalesTaxRate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: TAX_SETTINGS_ON_CONFLICT },
    );

    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return;
    }

    setInfoMessage("Product Sales Tax Rate saved.");
    setSaving(false);
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
        Product Sales Tax Rate
      </h3>
      <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {infoMessage ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {infoMessage}
          </p>
        ) : null}

        <div>
          <label
            htmlFor="product_sales_tax_rate"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Product Sales Tax Rate
          </label>
          <select
            id="product_sales_tax_rate"
            value={String(productSalesTaxRate)}
            onChange={(event) =>
              setProductSalesTaxRate(
                normalizeProductSalesTaxRate(Number(event.target.value)),
              )
            }
            className={inputClassName}
          >
            {PRODUCT_SALES_TAX_RATE_OPTIONS.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-slate-600">
            Default output tax treatment for Product Sales and POS checkout.
            This setting is stored independently and does not affect Client
            Invoice or Quotation VAT/WHT calculation basis.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className={primaryButtonClassName}
        >
          {saving ? "Saving…" : "Save Setting"}
        </button>
      </form>
    </section>
  );
}
