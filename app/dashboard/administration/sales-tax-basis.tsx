"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  DEFAULT_SALES_TAX_BASIS,
  SALES_TAX_BASIS_OPTIONS,
  formatSalesTaxBasisReviewLabel,
  normalizeSalesTaxBasis,
  type SalesTaxBasis,
} from "@/app/dashboard/finance/tax-utils";
import TaxSettingReviewBanner from "@/app/dashboard/finance/tax-setting-review-banner";

type SalesTaxBasisSettingsProps = {
  tenantId: string;
  initialSalesTaxBasis: SalesTaxBasis;
  initialSalesTaxBasisReviewedAt: string | null;
  fetchError?: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#18365c] disabled:cursor-not-allowed disabled:opacity-50";

export default function SalesTaxBasisSettings({
  tenantId,
  initialSalesTaxBasis,
  initialSalesTaxBasisReviewedAt,
  fetchError = null,
}: SalesTaxBasisSettingsProps) {
  const router = useRouter();
  const supabase = createClient();
  const [salesTaxBasis, setSalesTaxBasis] = useState<SalesTaxBasis>(
    initialSalesTaxBasis,
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setInfoMessage(null);

    const { error: saveError } = await supabase.from("tax_settings").upsert(
      {
        tenant_id: tenantId,
        sales_tax_basis: salesTaxBasis,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );

    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return;
    }

    setInfoMessage("VAT/WHT calculation basis saved.");
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <TaxSettingReviewBanner
        tenantId={tenantId}
        title="Review VAT/WHT calculation basis"
        body="New workspaces start with a default basis for Client Invoices and Quotations. Confirm or change it before you start invoicing — this does not block document creation."
        currentSettingLabel={formatSalesTaxBasisReviewLabel(salesTaxBasis)}
        reviewedAt={initialSalesTaxBasisReviewedAt}
        reviewField="sales_tax_basis_reviewed_at"
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
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
            htmlFor="sales_tax_basis"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            VAT/WHT Calculation Basis
          </label>
          <select
            id="sales_tax_basis"
            value={salesTaxBasis}
            onChange={(event) =>
              setSalesTaxBasis(
                normalizeSalesTaxBasis(event.target.value),
              )
            }
            className={inputClassName}
          >
            {SALES_TAX_BASIS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-slate-600">
            Controls how VAT/NHIL/GETFund and WHT are calculated on new Client
            Invoices and Client Quotations, and when existing drafts are saved
            again. Documents already issued keep their stored totals; this
            setting does not recalculate historical invoices or quotations.
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
    </div>
  );
}
