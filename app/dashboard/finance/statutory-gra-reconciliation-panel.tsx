"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { scopeToBusinessUnitId } from "@/utils/phase5e-key-structure";
import {
  GRA_RECONCILIATION_TOLERANCE,
  type GraReconciliationKind,
} from "./statutory-due-rules";
import { formatGHS } from "./tax-ledger-utils";

const inputClassName =
  "w-full max-w-[12rem] rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

type RowSpec = {
  kind: GraReconciliationKind;
  label: string;
  ledgerAmount: number;
};

export function StatutoryGraReconciliationPanel({
  tenantId,
  businessUnitId,
  periodMonth,
  rows,
}: {
  tenantId: string;
  businessUnitId: string | null;
  periodMonth: string | null;
  rows: RowSpec[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [portalAmounts, setPortalAmounts] = useState<
    Partial<Record<GraReconciliationKind, string>>
  >({});
  const [savingKind, setSavingKind] = useState<GraReconciliationKind | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const loadReconciliation = useCallback(async () => {
    if (!periodMonth) {
      setPortalAmounts({});
      return;
    }

    let query = supabase
      .from("statutory_gra_reconciliation")
      .select("reconciliation_kind, gra_portal_amount")
      .eq("tenant_id", tenantId)
      .eq("period_month", periodMonth);

    query = scopeToBusinessUnitId(query, businessUnitId);

    const { data, error: loadError } = await query;

    if (loadError) {
      setError(loadError.message);
      return;
    }

    const next: Partial<Record<GraReconciliationKind, string>> = {};
    for (const row of data ?? []) {
      const kind = row.reconciliation_kind as GraReconciliationKind;
      if (row.gra_portal_amount != null) {
        next[kind] = String(row.gra_portal_amount);
      }
    }
    setPortalAmounts(next);
    setError(null);
  }, [businessUnitId, periodMonth, supabase, tenantId]);

  useEffect(() => {
    void loadReconciliation();
  }, [loadReconciliation]);

  async function savePortalAmount(kind: GraReconciliationKind) {
    if (!periodMonth) {
      return;
    }

    setSavingKind(kind);
    setError(null);

    const raw = portalAmounts[kind]?.trim() ?? "";
    const graPortalAmount = raw === "" ? null : Number(raw);

    if (graPortalAmount != null && !Number.isFinite(graPortalAmount)) {
      setError("GRA portal amount must be a number.");
      setSavingKind(null);
      return;
    }

    const payload = {
      tenant_id: tenantId,
      business_unit_id: businessUnitId,
      period_month: periodMonth,
      reconciliation_kind: kind,
      gra_portal_amount: graPortalAmount,
      updated_at: new Date().toISOString(),
    };

    const { error: saveError } = await supabase
      .from("statutory_gra_reconciliation")
      .upsert(payload, {
        onConflict: "tenant_id,business_unit_id,period_month,reconciliation_kind",
      });

    if (saveError) {
      setError(saveError.message);
    }

    setSavingKind(null);
  }

  if (!periodMonth) {
    return (
      <p className="text-sm text-slate-600">
        Select a period month to compare ledger amounts with GRA portal figures.
      </p>
    );
  }

  return (
    <section className="mt-4 rounded-md border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-[#0f2744]">
        GRA portal reconciliation
      </h4>
      <p className="mt-1 text-xs text-slate-500">
        Enter amounts from the GRA portal for this period. Differences are
        highlighted; nothing is synced automatically.
      </p>
      {error ? (
        <p className="mt-2 text-sm text-red-700">{error}</p>
      ) : null}
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="pb-2 pr-4 font-medium">Kind</th>
              <th className="pb-2 pr-4 font-medium">Ledger (open)</th>
              <th className="pb-2 pr-4 font-medium">GRA portal</th>
              <th className="pb-2 font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const portalRaw = portalAmounts[row.kind]?.trim() ?? "";
              const portalValue =
                portalRaw === "" ? null : Number(portalRaw);
              const diff =
                portalValue == null || !Number.isFinite(portalValue)
                  ? null
                  : Math.round((row.ledgerAmount - portalValue) * 100) / 100;
              const mismatch =
                diff != null &&
                Math.abs(diff) > GRA_RECONCILIATION_TOLERANCE;

              return (
                <tr key={row.kind} className="border-t border-slate-100">
                  <td className="py-2 pr-4 font-medium text-slate-800">
                    {row.label}
                  </td>
                  <td className="py-2 pr-4">{formatGHS(row.ledgerAmount)}</td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Optional"
                        value={portalAmounts[row.kind] ?? ""}
                        onChange={(event) =>
                          setPortalAmounts((prev) => ({
                            ...prev,
                            [row.kind]: event.target.value,
                          }))
                        }
                        className={inputClassName}
                      />
                      <button
                        type="button"
                        disabled={savingKind === row.kind}
                        onClick={() => void savePortalAmount(row.kind)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {savingKind === row.kind ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </td>
                  <td
                    className={`py-2 ${mismatch ? "font-medium text-red-600" : "text-slate-700"}`}
                  >
                    {diff == null ? "—" : formatGHS(diff)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
