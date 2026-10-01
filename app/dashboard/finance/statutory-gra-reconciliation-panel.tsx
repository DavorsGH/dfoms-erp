"use client";



import Link from "next/link";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/utils/supabase/client";

import { scopeToBusinessUnitId } from "@/utils/phase5e-key-structure";

import {

  GRA_RECONCILIATION_TOLERANCE,

  type GraReconciliationKind,

} from "./statutory-due-rules";

import {

  formatGraLedgerStatusLabel,

  type GraReconciliationLedgerBreakdown,

} from "./gra-reconciliation-ledger";

import { GraReconciliationPenaltyDialog } from "./gra-reconciliation-penalty-dialog";

import {

  computeGraPenaltyRemainingAmount,

  isGraPenaltyFullyRecorded,

  parseGraPenaltyExpenseJoin,

  sumGraPenaltyRecordedAmount,

  type GraPenaltyExpenseLink,

  type GraReconciliationPenaltyRowState,

} from "./gra-reconciliation-penalty-state";

import { formatGHS } from "./tax-ledger-utils";

import type { VatReturnPeriod } from "./tax-utils";



const inputClassName =

  "w-full max-w-[12rem] rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";



type RowSpec = {

  kind: GraReconciliationKind;

  label: string;

  ledger: GraReconciliationLedgerBreakdown;

  dueDateIso: string;

};



type PenaltyLinkRow = {

  penalty_expense_id: string;

  expense_register:

    | { id: string; date: string; amount: number }

    | { id: string; date: string; amount: number }[]

    | null;

};



function parsePenaltyLinksFromRow(

  reconciliationId: string | null,

  linkRows: PenaltyLinkRow[] | null | undefined,

): GraReconciliationPenaltyRowState {

  const penalties: GraPenaltyExpenseLink[] = [];



  for (const link of linkRows ?? []) {

    const parsed = parseGraPenaltyExpenseJoin(

      link.expense_register,

      String(link.penalty_expense_id),

    );

    if (parsed) {

      penalties.push(parsed);

    }

  }



  penalties.sort((left, right) => left.date.localeCompare(right.date));



  return {

    reconciliationId,

    penalties,

  };

}



function PenaltyExpenseList({ penalties }: { penalties: GraPenaltyExpenseLink[] }) {

  return (

    <ul className="space-y-1 text-xs text-slate-700">

      {penalties.map((penalty) => (

        <li key={penalty.expenseId}>

          {formatGHS(penalty.amount)}{" "}

          <Link

            href={`/dashboard/finance/expenses?expenseId=${encodeURIComponent(penalty.expenseId)}`}

            className="font-medium text-[#0f2744] underline"

          >

            {penalty.date || "view"}

          </Link>

        </li>

      ))}

    </ul>

  );

}



export function StatutoryGraReconciliationPanel({

  tenantId,

  businessUnitId,

  periodMonth,

  rows,

  vatReturnPeriod,

}: {

  tenantId: string;

  businessUnitId: string | null;

  periodMonth: string | null;

  rows: RowSpec[];

  vatReturnPeriod: VatReturnPeriod;

}) {

  const supabase = useMemo(() => createClient(), []);

  const [portalAmounts, setPortalAmounts] = useState<

    Partial<Record<GraReconciliationKind, string>>

  >({});

  const [penaltyStateByKind, setPenaltyStateByKind] = useState<

    Partial<Record<GraReconciliationKind, GraReconciliationPenaltyRowState>>

  >({});

  const [savingKind, setSavingKind] = useState<GraReconciliationKind | null>(

    null,

  );

  const [penaltyDialogKind, setPenaltyDialogKind] =

    useState<GraReconciliationKind | null>(null);

  const [penaltyDialogAmount, setPenaltyDialogAmount] = useState<number | null>(

    null,

  );

  const [error, setError] = useState<string | null>(null);



  const loadReconciliation = useCallback(async () => {

    if (!periodMonth) {

      setPortalAmounts({});

      setPenaltyStateByKind({});

      return;

    }



    let query = supabase

      .from("statutory_gra_reconciliation")

      .select(

        "id, reconciliation_kind, gra_portal_amount, statutory_gra_reconciliation_penalty_expenses ( penalty_expense_id, expense_register:penalty_expense_id ( id, date, amount ) )",

      )

      .eq("tenant_id", tenantId)

      .eq("period_month", periodMonth);



    query = scopeToBusinessUnitId(query, businessUnitId);



    const { data, error: loadError } = await query;



    if (loadError) {

      setError(loadError.message);

      return;

    }



    const nextPortal: Partial<Record<GraReconciliationKind, string>> = {};

    const nextPenalty: Partial<

      Record<GraReconciliationKind, GraReconciliationPenaltyRowState>

    > = {};



    for (const row of data ?? []) {

      const kind = row.reconciliation_kind as GraReconciliationKind;

      if (row.gra_portal_amount != null) {

        nextPortal[kind] = String(row.gra_portal_amount);

      }



      nextPenalty[kind] = parsePenaltyLinksFromRow(

        (row.id as string | null) ?? null,

        row.statutory_gra_reconciliation_penalty_expenses as

          | PenaltyLinkRow[]

          | null,

      );

    }



    setPortalAmounts(nextPortal);

    setPenaltyStateByKind(nextPenalty);

    setError(null);

  }, [businessUnitId, periodMonth, supabase, tenantId]);



  useEffect(() => {

    void loadReconciliation();

  }, [loadReconciliation]);



  async function ensureReconciliationRow(

    kind: GraReconciliationKind,

  ): Promise<string | null> {

    if (!periodMonth) {

      return null;

    }



    const raw = portalAmounts[kind]?.trim() ?? "";

    const graPortalAmount = raw === "" ? null : Number(raw);



    const payload = {

      tenant_id: tenantId,

      business_unit_id: businessUnitId,

      period_month: periodMonth,

      reconciliation_kind: kind,

      gra_portal_amount: Number.isFinite(graPortalAmount as number)

        ? graPortalAmount

        : null,

      updated_at: new Date().toISOString(),

    };



    const { data, error: upsertError } = await supabase

      .from("statutory_gra_reconciliation")

      .upsert(payload, {

        onConflict: "tenant_id,business_unit_id,period_month,reconciliation_kind",

      })

      .select("id")

      .single();



    if (upsertError) {

      setError(upsertError.message);

      return null;

    }



    return (data?.id as string | null) ?? null;

  }



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



    const reconciliationId = await ensureReconciliationRow(kind);

    if (!reconciliationId && graPortalAmount != null) {

      setSavingKind(null);

      return;

    }



    setSavingKind(null);

    void loadReconciliation();

  }



  async function addPenaltyExpenseLink(

    kind: GraReconciliationKind,

    expenseId: string,

    expenseDate: string,

    amount: number,

  ) {

    if (!periodMonth) {

      return;

    }



    const reconciliationId =

      penaltyStateByKind[kind]?.reconciliationId ??

      (await ensureReconciliationRow(kind));



    if (!reconciliationId) {

      setError("Could not resolve reconciliation row for this period.");

      return;

    }



    const { error: linkError } = await supabase

      .from("statutory_gra_reconciliation_penalty_expenses")

      .insert({

        reconciliation_id: reconciliationId,

        tenant_id: tenantId,

        penalty_expense_id: expenseId,

      });



    if (linkError) {

      setError(linkError.message);

      return;

    }



    await supabase

      .from("statutory_gra_reconciliation")

      .update({

        penalty_expense_id: expenseId,

        updated_at: new Date().toISOString(),

      })

      .eq("id", reconciliationId);



    setPenaltyStateByKind((prev) => {

      const existing = prev[kind] ?? {

        reconciliationId,

        penalties: [],

      };

      const penalties = [...existing.penalties];

      if (!penalties.some((row) => row.expenseId === expenseId)) {

        penalties.push({ expenseId, date: expenseDate, amount });

        penalties.sort((left, right) => left.date.localeCompare(right.date));

      }

      return {

        ...prev,

        [kind]: {

          reconciliationId,

          penalties,

        },

      };

    });



    void loadReconciliation();

  }



  function openPenaltyDialog(kind: GraReconciliationKind, amount: number) {

    setPenaltyDialogAmount(amount);

    setPenaltyDialogKind(kind);

  }



  function closePenaltyDialog() {

    setPenaltyDialogKind(null);

    setPenaltyDialogAmount(null);

  }



  const penaltyDialogRow = penaltyDialogKind

    ? rows.find((row) => row.kind === penaltyDialogKind)

    : null;



  const penaltyDialogResolvedAmount =

    penaltyDialogKind && penaltyDialogRow

      ? (penaltyDialogAmount ??

        Math.round(

          Math.abs(

            penaltyDialogRow.ledger.totalAmount -

              (Number(portalAmounts[penaltyDialogKind]) || 0),

          ) * 100,

        ) / 100)

      : 0;



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

        Enter amounts from the GRA portal for this period. Ledger totals include

        open and remitted entries for the period. Differences are highlighted;

        nothing is synced automatically.

      </p>

      {error ? (

        <p className="mt-2 text-sm text-red-700">{error}</p>

      ) : null}

      <div className="mt-3 overflow-x-auto">

        <table className="min-w-full text-sm">

          <thead>

            <tr className="text-left text-slate-600">

              <th className="pb-2 pr-4 font-medium">Kind</th>

              <th className="pb-2 pr-4 font-medium">Ledger (total)</th>

              <th className="pb-2 pr-4 font-medium">GRA portal</th>

              <th className="pb-2 pr-4 font-medium">Difference</th>

              <th className="pb-2 font-medium">Actions</th>

            </tr>

          </thead>

          <tbody>

            {rows.map((row) => {

              const portalRaw = portalAmounts[row.kind]?.trim() ?? "";

              const portalValue =

                portalRaw === "" ? null : Number(portalRaw);

              const ledgerTotal = row.ledger.totalAmount;

              const diff =

                portalValue == null || !Number.isFinite(portalValue)

                  ? null

                  : Math.round((ledgerTotal - portalValue) * 100) / 100;

              const mismatch =

                diff != null &&

                Math.abs(diff) > GRA_RECONCILIATION_TOLERANCE;

              const graExceedsLedger =

                portalValue != null &&

                Number.isFinite(portalValue) &&

                portalValue > ledgerTotal + GRA_RECONCILIATION_TOLERANCE;

              const requiredPenaltyAmount =

                graExceedsLedger && diff != null

                  ? Math.round(Math.abs(diff) * 100) / 100

                  : 0;

              const penaltyState = penaltyStateByKind[row.kind];

              const penalties = penaltyState?.penalties ?? [];

              const recordedTotal = sumGraPenaltyRecordedAmount(penalties);

              const remainingAmount = computeGraPenaltyRemainingAmount(

                requiredPenaltyAmount,

                penalties,

              );

              const fullyRecorded = isGraPenaltyFullyRecorded(

                requiredPenaltyAmount,

                penalties,

              );

              const showInitialRecordButton =

                graExceedsLedger &&

                requiredPenaltyAmount > 0 &&

                penalties.length === 0;



              return (

                <tr key={row.kind} className="border-t border-slate-100">

                  <td className="py-2 pr-4 font-medium text-slate-800">

                    {row.label}

                  </td>

                  <td className="py-2 pr-4">

                    <div>{formatGHS(ledgerTotal)}</div>

                    <div className="text-xs text-slate-500">

                      {formatGraLedgerStatusLabel(row.ledger)}

                    </div>

                  </td>

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

                    className={`py-2 pr-4 ${mismatch ? "font-medium text-red-600" : "text-slate-700"}`}

                  >

                    {diff == null ? "—" : formatGHS(diff)}

                  </td>

                  <td className="py-2">

                    {penalties.length > 0 ? (

                      <div className="space-y-2">

                        {!fullyRecorded && requiredPenaltyAmount > 0 ? (

                          <p className="text-xs text-slate-700">

                            Recorded {formatGHS(recordedTotal)} ·{" "}

                            {formatGHS(remainingAmount)} not yet recorded

                          </p>

                        ) : null}

                        <PenaltyExpenseList penalties={penalties} />

                        {!fullyRecorded && remainingAmount > 0 ? (

                          <button

                            type="button"

                            onClick={() =>

                              openPenaltyDialog(row.kind, remainingAmount)

                            }

                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"

                          >

                            Record remaining as expense

                          </button>

                        ) : null}

                      </div>

                    ) : showInitialRecordButton ? (

                      <button

                        type="button"

                        onClick={() =>

                          openPenaltyDialog(row.kind, requiredPenaltyAmount)

                        }

                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"

                      >

                        Record difference as expense

                      </button>

                    ) : (

                      <span className="text-xs text-slate-400">—</span>

                    )}

                  </td>

                </tr>

              );

            })}

          </tbody>

        </table>

      </div>



      {penaltyDialogKind && penaltyDialogRow ? (

        <GraReconciliationPenaltyDialog

          tenantId={tenantId}

          businessUnitId={businessUnitId}

          periodMonth={periodMonth}

          kind={penaltyDialogKind}

          penaltyAmount={penaltyDialogResolvedAmount}

          dueDateIso={penaltyDialogRow.dueDateIso}

          hasRemittedLedgerActivity={

            penaltyDialogRow.ledger.remittedAmount !== 0

          }

          vatReturnPeriod={vatReturnPeriod}

          onClose={closePenaltyDialog}

          onSaved={(expenseId, expenseDate, amount) => {

            void addPenaltyExpenseLink(

              penaltyDialogKind,

              expenseId,

              expenseDate,

              amount,

            );

            closePenaltyDialog();

          }}

        />

      ) : null}

    </section>

  );

}


