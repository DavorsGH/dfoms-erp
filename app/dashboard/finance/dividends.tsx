"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAlert, useConfirm, usePrompt, useToast } from "@/components/feedback";
import type { DialogDetailRow } from "@/components/feedback/dialog-detail-list";
import { useBusinessUnitView } from "@/app/dashboard/business-unit-view-context";
import { formatGHS, formatDate } from "./income-register-utils";
import type {
  DividendDeclarationLineRow,
  DividendDeclarationRow,
  ShareholderPaymentMethod,
  TenantShareholderRow,
} from "./dividends-types";
import { lineFullyPaid, sumActiveSharePct } from "@/lib/finance/dividends-server";

export type DividendsViewMode = "all" | "declarations" | "shareholders";

type DividendsProps = {
  tenantId: string;
  canManage: boolean;
  initialShareholders: TenantShareholderRow[];
  initialDeclarations: DividendDeclarationRow[];
  initialLines: DividendDeclarationLineRow[];
  fetchError: string | null;
  viewMode?: DividendsViewMode;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#18365c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

const DIRECTORS_ALERT_TITLE = "Could not complete action";

function formatShareholderPaymentMethod(method: string | null | undefined): string {
  if (!method) return "—";
  if (method === "momo") return "MoMo";
  return method.charAt(0).toUpperCase() + method.slice(1);
}

/** Start/end of the most recently completed calendar quarter before `isoDate`. */
function priorCompletedQuarterBounds(isoDate: string): { start: string; end: string } {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  let year = d.getFullYear();
  const currentQStartMonth = Math.floor(d.getMonth() / 3) * 3;
  let prevQStartMonth = currentQStartMonth - 3;
  if (prevQStartMonth < 0) {
    prevQStartMonth = 9;
    year -= 1;
  }
  const start = new Date(year, prevQStartMonth, 1);
  const end = new Date(year, prevQStartMonth + 3, 0);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export default function Dividends({
  canManage,
  initialShareholders,
  initialDeclarations,
  initialLines,
  fetchError,
  viewMode = "all",
}: DividendsProps) {
  const showShareholders = viewMode === "all" || viewMode === "shareholders";
  const showDeclarations = viewMode === "all" || viewMode === "declarations";
  const { alertError } = useAlert();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { toast } = useToast();
  const { viewAllBusinessUnits, activeBusinessUnitId } = useBusinessUnitView();

  const [shareholders, setShareholders] = useState(initialShareholders);
  const [declarations, setDeclarations] = useState(initialDeclarations);
  const [lines, setLines] = useState(initialLines);
  const [selectedDeclarationId, setSelectedDeclarationId] = useState<string | null>(
    initialDeclarations[0]?.id ?? null,
  );

  const [shareholderFormOpen, setShareholderFormOpen] = useState(false);
  const [editingShareholderId, setEditingShareholderId] = useState<string | null>(null);
  const [shareholderFieldErrors, setShareholderFieldErrors] = useState<
    Record<string, string>
  >({});
  const [shareholderForm, setShareholderForm] = useState({
    full_name: "",
    share_pct: "",
    tin: "",
    staff_id: "",
    payment_method: "bank" as ShareholderPaymentMethod,
    momo_number: "",
    bank_name: "",
    bank_account_number: "",
  });

  const [declareContext, setDeclareContext] = useState<{
    retainedEarnings: number | null;
    dividendAvailable: number | null;
    declaredThisQuarter: number | null;
  } | null>(null);
  const [declareFormOpen, setDeclareFormOpen] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const declareFormRef = useRef<HTMLFormElement>(null);
  const periodEndRef = useRef<HTMLInputElement>(null);
  const [paymentLine, setPaymentLine] = useState<DividendDeclarationLineRow | null>(
    null,
  );
  const [paymentForm, setPaymentForm] = useState({
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: "bank" as ShareholderPaymentMethod,
    payment_reference: "",
  });
  const [declareFieldErrors, setDeclareFieldErrors] = useState<Record<string, string>>(
    {},
  );
  const [declareForm, setDeclareForm] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    const q = priorCompletedQuarterBounds(today);
    return {
      declaration_date: today,
      period_start: q.start,
      period_end: q.end,
      resolution_reference: "",
      resolution_notes: "",
      gross_amount: "",
      wht_rate_pct: 8,
    };
  });

  const pendingRef = useRef(new Set<string>());
  const [, setPendingTick] = useState(0);

  function isPending(key: string): boolean {
    return pendingRef.current.has(key);
  }

  function beginPending(key: string): boolean {
    if (pendingRef.current.has(key)) {
      return false;
    }
    pendingRef.current.add(key);
    setPendingTick((n) => n + 1);
    return true;
  }

  function endPending(key: string): void {
    if (pendingRef.current.delete(key)) {
      setPendingTick((n) => n + 1);
    }
  }

  useEffect(() => {
    if (fetchError) {
      void alertError(fetchError, { title: DIRECTORS_ALERT_TITLE });
    }
  }, [alertError, fetchError]);

  useEffect(() => {
    setShareholders(initialShareholders);
    setDeclarations(initialDeclarations);
    setLines(initialLines);
    setSelectedDeclarationId(initialDeclarations[0]?.id ?? null);
  }, [initialShareholders, initialDeclarations, initialLines]);

  useEffect(() => {
    void reloadAll();
    setSelectedDeclarationId(null);
  }, [activeBusinessUnitId, viewAllBusinessUnits]);

  const activeShareTotal = useMemo(
    () => sumActiveSharePct(shareholders),
    [shareholders],
  );

  const selectedDeclaration = useMemo(
    () => declarations.find((row) => row.id === selectedDeclarationId) ?? null,
    [declarations, selectedDeclarationId],
  );

  const selectedLines = useMemo(
    () =>
      lines.filter((row) => row.declaration_id === selectedDeclarationId),
    [lines, selectedDeclarationId],
  );

  const grossAmountPreview = Number(declareForm.gross_amount) || 0;
  const whtPreview = Math.round(grossAmountPreview * declareForm.wht_rate_pct) / 100;
  const netPreview = Math.round((grossAmountPreview - whtPreview) * 100) / 100;

  async function reloadAll() {
    const [sh, decl] = await Promise.all([
      fetch("/api/finance/shareholders").then((r) => r.json()),
      fetch("/api/finance/dividend-declarations").then((r) => r.json()),
    ]);
    if (sh.shareholders) setShareholders(sh.shareholders);
    if (decl.declarations) setDeclarations(decl.declarations);
    if (decl.lines) setLines(decl.lines);
  }

  function mergeShareholderFromWrite(
    shareholder: TenantShareholderRow,
    isNew: boolean,
  ) {
    setShareholders((prev) => {
      const existing = prev.find((row) => row.id === shareholder.id);
      const merged: TenantShareholderRow = {
        ...shareholder,
        can_delete: isNew ? true : existing?.can_delete,
      };
      const without = prev.filter((row) => row.id !== merged.id);
      return [...without, merged].sort((a, b) =>
        a.full_name.localeCompare(b.full_name),
      );
    });
  }

  function removeShareholderFromState(id: string) {
    setShareholders((prev) => prev.filter((row) => row.id !== id));
  }

  function applyDeclarationWritePatch(data: {
    declaration?: DividendDeclarationRow | null;
    lines?: DividendDeclarationLineRow[];
  }): boolean {
    if (!data.declaration?.id) {
      return false;
    }
    const declarationId = data.declaration.id;
    setDeclarations((prev) => {
      const index = prev.findIndex((row) => row.id === declarationId);
      if (index >= 0) {
        const next = [...prev];
        next[index] = data.declaration!;
        return next;
      }
      return [data.declaration!, ...prev];
    });
    if (data.lines) {
      setLines((prev) => [
        ...prev.filter((row) => row.declaration_id !== declarationId),
        ...data.lines!,
      ]);
    }
    return true;
  }

  function removeDeclarationFromState(id: string) {
    setDeclarations((prev) => prev.filter((row) => row.id !== id));
    setLines((prev) => prev.filter((row) => row.declaration_id !== id));
  }

  function resetShareholderForm() {
    setShareholderForm({
      full_name: "",
      share_pct: "",
      tin: "",
      staff_id: "",
      payment_method: "bank",
      momo_number: "",
      bank_name: "",
      bank_account_number: "",
    });
    setShareholderFieldErrors({});
    setEditingShareholderId(null);
  }

  async function saveShareholder() {
    const errors: Record<string, string> = {};
    if (!shareholderForm.full_name.trim()) {
      errors.full_name = "Full name is required.";
    }
    const pct = Number(shareholderForm.share_pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      errors.share_pct = "Enter a share percentage between 0 and 100.";
    }
    setShareholderFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    if (!beginPending("shareholder-save")) {
      return;
    }

    try {
      const payload = {
        full_name: shareholderForm.full_name.trim(),
        share_pct: pct,
        tin: shareholderForm.tin.trim() || null,
        staff_id: shareholderForm.staff_id.trim() || null,
        payment_method: shareholderForm.payment_method,
        momo_number: shareholderForm.momo_number.trim() || null,
        bank_name: shareholderForm.bank_name.trim() || null,
        bank_account_number: shareholderForm.bank_account_number.trim() || null,
        is_active: true,
      };

      const url = editingShareholderId
        ? `/api/finance/shareholders/${editingShareholderId}`
        : "/api/finance/shareholders";
      const response = await fetch(url, {
        method: editingShareholderId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        void alertError(data.error ?? "Could not save shareholder.", {
          title: DIRECTORS_ALERT_TITLE,
        });
        return;
      }

      if (!data.shareholder?.id) {
        await reloadAll();
        return;
      }
      mergeShareholderFromWrite(data.shareholder, !editingShareholderId);
      toast(editingShareholderId ? "Shareholder updated." : "Shareholder added.");
      setShareholderFormOpen(false);
      resetShareholderForm();
    } finally {
      endPending("shareholder-save");
    }
  }

  async function deactivateShareholder(id: string) {
    const ok = await confirm({
      title: "Deactivate shareholder?",
      message: "They will be excluded from new dividend lines.",
      confirmLabel: "Deactivate",
    });
    if (!ok) return;

    const pendingKey = `shareholder-deactivate:${id}`;
    if (!beginPending(pendingKey)) {
      return;
    }
    try {
      const response = await fetch(`/api/finance/shareholders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
      const data = await response.json();
      if (!response.ok) {
        void alertError(data.error ?? "Could not deactivate.", {
          title: DIRECTORS_ALERT_TITLE,
        });
        return;
      }
      if (!data.shareholder?.id) {
        await reloadAll();
        return;
      }
      mergeShareholderFromWrite(data.shareholder, false);
      toast("Shareholder deactivated.");
    } finally {
      endPending(pendingKey);
    }
  }

  async function reactivateShareholder(id: string) {
    const pendingKey = `shareholder-reactivate:${id}`;
    if (!beginPending(pendingKey)) {
      return;
    }
    try {
      const response = await fetch(`/api/finance/shareholders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        void alertError(data.error ?? "Could not reactivate.", {
          title: DIRECTORS_ALERT_TITLE,
        });
        return;
      }
      if (!data.shareholder?.id) {
        await reloadAll();
        return;
      }
      mergeShareholderFromWrite(data.shareholder, false);
      toast("Shareholder reactivated.");
    } finally {
      endPending(pendingKey);
    }
  }

  async function deleteShareholder(id: string, fullName: string) {
    const ok = await confirm({
      title: `Delete ${fullName}?`,
      message: "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;

    const pendingKey = `shareholder-delete:${id}`;
    if (!beginPending(pendingKey)) {
      return;
    }
    try {
      const response = await fetch(`/api/finance/shareholders/${id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        void alertError(data.error ?? "Could not delete shareholder.", {
          title: DIRECTORS_ALERT_TITLE,
        });
        return;
      }
      removeShareholderFromState(id);
      toast("Shareholder deleted.");
    } finally {
      endPending(pendingKey);
    }
  }

  function validateDeclarationForm(requireResolution: boolean): boolean {
    periodEndRef.current?.setCustomValidity("");
    if (
      declareForm.period_start &&
      declareForm.period_end &&
      declareForm.period_end < declareForm.period_start
    ) {
      periodEndRef.current?.setCustomValidity(
        "Profit period end must be on or after the start date.",
      );
      periodEndRef.current?.reportValidity();
      return false;
    }
    if (!declareFormRef.current?.reportValidity()) {
      return false;
    }
    if (requireResolution && !declareForm.resolution_reference.trim()) {
      void alertError("Resolution reference is required before you declare.", {
        title: DIRECTORS_ALERT_TITLE,
      });
      return false;
    }
    return true;
  }

  function openNewDeclarationForm() {
    const today = new Date().toISOString().slice(0, 10);
    const q = priorCompletedQuarterBounds(today);
    setEditingDraftId(null);
    setDeclareForm({
      declaration_date: today,
      period_start: q.start,
      period_end: q.end,
      resolution_reference: "",
      resolution_notes: "",
      gross_amount: "",
      wht_rate_pct: 8,
    });
    setDeclareFieldErrors({});
    setDeclareFormOpen(true);
  }

  function openEditDraftForm(row: DividendDeclarationRow) {
    setEditingDraftId(row.id);
    setDeclareForm({
      declaration_date: row.declaration_date.slice(0, 10),
      period_start: row.period_start.slice(0, 10),
      period_end: row.period_end.slice(0, 10),
      resolution_reference: row.resolution_reference ?? "",
      resolution_notes: row.resolution_notes ?? "",
      gross_amount: String(row.gross_amount),
      wht_rate_pct: row.wht_rate_pct,
    });
    setDeclareFieldErrors({});
    setDeclareFormOpen(true);
  }

  function ensureActiveSharesTotal100(): boolean {
    if (Math.abs(activeShareTotal - 100) <= 0.01) {
      return true;
    }
    void alertError(
      `Active shareholders must total 100% (currently ${activeShareTotal}%).`,
      { title: DIRECTORS_ALERT_TITLE },
    );
    return false;
  }

  async function saveDraftDeclaration() {
    if (viewAllBusinessUnits) {
      void alertError(
        "Select the business unit that is paying this dividend (All businesses is not allowed).",
        { title: DIRECTORS_ALERT_TITLE },
      );
      return;
    }

    if (!validateDeclarationForm(false)) {
      return;
    }

    if (!ensureActiveSharesTotal100()) {
      return;
    }

    const errors: Record<string, string> = {};
    const gross = Number(declareForm.gross_amount);
    if (!Number.isFinite(gross) || gross <= 0) {
      errors.gross_amount = "Enter a gross amount greater than zero.";
    }
    setDeclareFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    if (!beginPending("draft-save")) {
      return;
    }

    try {
      const payload = {
        declaration_date: declareForm.declaration_date,
        period_start: declareForm.period_start,
        period_end: declareForm.period_end,
        resolution_reference: declareForm.resolution_reference.trim() || null,
        resolution_notes: declareForm.resolution_notes.trim() || null,
        gross_amount: gross,
      };

      const response = await fetch(
        editingDraftId
          ? `/api/finance/dividend-declarations/${editingDraftId}`
          : "/api/finance/dividend-declarations",
        {
          method: editingDraftId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        void alertError(data.error ?? "Could not save draft.", {
          title: DIRECTORS_ALERT_TITLE,
        });
        return;
      }

      if (!applyDeclarationWritePatch(data)) {
        await reloadAll();
        return;
      }
      toast(editingDraftId ? "Draft updated." : "Draft saved.");
      setDeclareFormOpen(false);
      setEditingDraftId(null);
      if (data.declaration?.id) {
        setSelectedDeclarationId(data.declaration.id);
      }
    } finally {
      endPending("draft-save");
    }
  }

  async function declareDraft(id: string) {
    if (!ensureActiveSharesTotal100()) {
      return;
    }

    const row = declarations.find((d) => d.id === id);
    if (!row?.resolution_reference?.trim()) {
      void alertError(
        "Add a resolution reference on the draft before declaring (Edit draft).",
        { title: DIRECTORS_ALERT_TITLE },
      );
      return;
    }
    if (row.period_end < row.period_start) {
      void alertError("Profit period end must be on or after the start date.", {
        title: DIRECTORS_ALERT_TITLE,
      });
      return;
    }

    const pendingKey = `declare:${id}`;
    if (!beginPending(pendingKey)) {
      return;
    }

    try {
      const readinessResponse = await fetch(
        `/api/finance/dividend-declarations/${id}/declare-readiness`,
      );
      const readiness = await readinessResponse.json();
      if (!readinessResponse.ok) {
        void alertError(readiness.error ?? "Could not check declare readiness.", {
          title: DIRECTORS_ALERT_TITLE,
        });
        return;
      }

      const warningDetails: DialogDetailRow[] = (readiness.warnings ?? []).map(
        (w: { message: string }) => ({ label: "Warning", value: w.message }),
      );

      if (readiness.warnings?.length) {
        const ok = await confirm({
          title: "Declare anyway?",
          message:
            "The scorecard suggests this dividend is not fully ready. Review the items below before you continue.",
          details: warningDetails,
          confirmLabel: "Declare anyway",
        });
        if (!ok) return;
      } else {
        const ok = await confirm({
          title: "Declare dividend?",
          message:
            "This will post dividend WHT to the Statutory Ledger and reduce retained earnings.",
          confirmLabel: "Declare",
        });
        if (!ok) return;
      }

      const response = await fetch(`/api/finance/dividend-declarations/${id}/declare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_spec_warnings: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        void alertError(data.error ?? "Declare failed.", { title: DIRECTORS_ALERT_TITLE });
        return;
      }
      if (!applyDeclarationWritePatch(data)) {
        await reloadAll();
        return;
      }
      toast("Dividend declared.");
    } finally {
      endPending(pendingKey);
    }
  }

  async function cancelDeclared(id: string) {
    const reason = await prompt({
      title: "Cancel declaration",
      message: "Enter a reason for cancelling this declared dividend.",
      inputLabel: "Reason",
      required: true,
      confirmLabel: "Cancel declaration",
    });
    if (!reason?.trim()) return;

    const pendingKey = `cancel-declaration:${id}`;
    if (!beginPending(pendingKey)) {
      return;
    }
    try {
      const response = await fetch(
        `/api/finance/dividend-declarations/${id}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cancel_reason: reason.trim() }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        void alertError(data.error ?? "Cancel failed.", { title: DIRECTORS_ALERT_TITLE });
        return;
      }
      if (!applyDeclarationWritePatch(data)) {
        await reloadAll();
        return;
      }
      toast("Declaration cancelled.");
    } finally {
      endPending(pendingKey);
    }
  }

  useEffect(() => {
    if (!declareFormOpen || viewAllBusinessUnits || !activeBusinessUnitId) {
      setDeclareContext(null);
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/finance/dividend-declarations/form-context?declaration_date=${encodeURIComponent(declareForm.declaration_date)}`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setDeclareContext(null);
          return;
        }
        setDeclareContext({
          retainedEarnings: data.retainedEarnings ?? null,
          dividendAvailable: data.dividendAvailable ?? null,
          declaredThisQuarter: data.declaredThisQuarter ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setDeclareContext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    declareFormOpen,
    declareForm.declaration_date,
    viewAllBusinessUnits,
    activeBusinessUnitId,
  ]);

  async function deleteDraft(id: string) {
    const ok = await confirm({
      title: "Delete draft?",
      message: "This draft and its lines will be removed.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;

    const pendingKey = `draft-delete:${id}`;
    if (!beginPending(pendingKey)) {
      return;
    }
    try {
      const response = await fetch(`/api/finance/dividend-declarations/${id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        void alertError(data.error ?? "Delete failed.", { title: DIRECTORS_ALERT_TITLE });
        return;
      }
      removeDeclarationFromState(id);
      toast("Draft deleted.");
      setSelectedDeclarationId(null);
    } finally {
      endPending(pendingKey);
    }
  }

  function openPaymentModal(line: DividendDeclarationLineRow) {
    setPaymentForm({
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: line.payment_method ?? "bank",
      payment_reference: "",
    });
    setPaymentLine(line);
  }

  async function submitPayment() {
    if (!paymentLine) return;
    if (!paymentForm.payment_date.trim()) {
      void alertError("Payment date is required.", { title: DIRECTORS_ALERT_TITLE });
      return;
    }

    if (!beginPending("record-payment")) {
      return;
    }
    try {
      const response = await fetch(
        `/api/finance/dividend-declaration-lines/${paymentLine.id}/pay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment_date: paymentForm.payment_date.trim(),
            payment_method: paymentForm.payment_method,
            payment_reference: paymentForm.payment_reference.trim() || null,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        void alertError(data.error ?? "Payment failed.", { title: DIRECTORS_ALERT_TITLE });
        return;
      }
      if (!applyDeclarationWritePatch(data)) {
        await reloadAll();
        return;
      }
      toast("Payment recorded.");
      setPaymentLine(null);
    } finally {
      endPending("record-payment");
    }
  }

  return (
    <div className="space-y-10">
      {showShareholders ? (
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#0f2744]">Shareholder register</h3>
            <p className="text-sm text-slate-600">
              Active shares total:{" "}
              <span
                className={
                  Math.abs(activeShareTotal - 100) < 0.01
                    ? "font-medium text-emerald-700"
                    : "font-medium text-amber-800"
                }
              >
                {activeShareTotal}%
              </span>
            </p>
          </div>
          {canManage ? (
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={() => {
                resetShareholderForm();
                setShareholderFormOpen(true);
              }}
            >
              Add shareholder
            </button>
          ) : null}
        </div>

        <ul className="divide-y divide-slate-200 text-sm">
          {shareholders.map((row) => (
            <li
              key={row.id}
              className={`flex flex-wrap items-center justify-between gap-2 py-3 ${
                row.is_active ? "" : "text-slate-500"
              }`}
            >
              <div>
                <p className={row.is_active ? "font-medium text-slate-900" : "font-medium"}>
                  {row.full_name}{" "}
                  {!row.is_active ? (
                    <span className="text-xs font-normal uppercase tracking-wide text-slate-400">
                      Inactive
                    </span>
                  ) : null}
                </p>
                <p className={row.is_active ? "text-slate-600" : "text-slate-500"}>
                  {row.share_pct}% · {row.payment_method}
                  {row.tin ? ` · TIN ${row.tin}` : ""}
                </p>
              </div>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  {row.is_active ? (
                    <>
                      <button
                        type="button"
                        className={secondaryButtonClassName}
                        onClick={() => {
                          setEditingShareholderId(row.id);
                          setShareholderForm({
                            full_name: row.full_name,
                            share_pct: String(row.share_pct),
                            tin: row.tin ?? "",
                            staff_id: row.staff_id ?? "",
                            payment_method: row.payment_method,
                            momo_number: row.momo_number ?? "",
                            bank_name: row.bank_name ?? "",
                            bank_account_number: row.bank_account_number ?? "",
                          });
                          setShareholderFormOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={secondaryButtonClassName}
                        disabled={isPending(`shareholder-deactivate:${row.id}`)}
                        onClick={() => void deactivateShareholder(row.id)}
                      >
                        {isPending(`shareholder-deactivate:${row.id}`)
                          ? "Deactivating…"
                          : "Deactivate"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      disabled={isPending(`shareholder-reactivate:${row.id}`)}
                      onClick={() => void reactivateShareholder(row.id)}
                    >
                      {isPending(`shareholder-reactivate:${row.id}`)
                        ? "Reactivating…"
                        : "Reactivate"}
                    </button>
                  )}
                  {row.can_delete ? (
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      disabled={isPending(`shareholder-delete:${row.id}`)}
                      onClick={() => void deleteShareholder(row.id, row.full_name)}
                    >
                      {isPending(`shareholder-delete:${row.id}`) ? "Deleting…" : "Delete"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {shareholderFormOpen && canManage ? (
          <div className="mt-6 grid gap-4 border-t border-slate-200 pt-6 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Full name
              </label>
              <input
                className={inputClassName}
                value={shareholderForm.full_name}
                onChange={(e) =>
                  setShareholderForm((f) => ({ ...f, full_name: e.target.value }))
                }
                aria-invalid={Boolean(shareholderFieldErrors.full_name)}
              />
              {shareholderFieldErrors.full_name ? (
                <p className="mt-1 text-xs text-red-700">
                  {shareholderFieldErrors.full_name}
                </p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Share %
              </label>
              <input
                className={inputClassName}
                value={shareholderForm.share_pct}
                onChange={(e) =>
                  setShareholderForm((f) => ({ ...f, share_pct: e.target.value }))
                }
                aria-invalid={Boolean(shareholderFieldErrors.share_pct)}
              />
              {shareholderFieldErrors.share_pct ? (
                <p className="mt-1 text-xs text-red-700">
                  {shareholderFieldErrors.share_pct}
                </p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Payment method
              </label>
              <select
                className={inputClassName}
                value={shareholderForm.payment_method}
                onChange={(e) =>
                  setShareholderForm((f) => ({
                    ...f,
                    payment_method: e.target.value as ShareholderPaymentMethod,
                  }))
                }
              >
                <option value="bank">Bank</option>
                <option value="momo">MoMo</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            {shareholderForm.payment_method === "momo" ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  MoMo number
                </label>
                <input
                  className={inputClassName}
                  value={shareholderForm.momo_number}
                  onChange={(e) =>
                    setShareholderForm((f) => ({ ...f, momo_number: e.target.value }))
                  }
                />
              </div>
            ) : null}
            {shareholderForm.payment_method === "bank" ? (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Bank name
                  </label>
                  <input
                    className={inputClassName}
                    value={shareholderForm.bank_name}
                    onChange={(e) =>
                      setShareholderForm((f) => ({ ...f, bank_name: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Account number
                  </label>
                  <input
                    className={inputClassName}
                    value={shareholderForm.bank_account_number}
                    onChange={(e) =>
                      setShareholderForm((f) => ({
                        ...f,
                        bank_account_number: e.target.value,
                      }))
                    }
                  />
                </div>
              </>
            ) : null}
            <div className="md:col-span-2 flex gap-2">
              <button
                type="button"
                className={primaryButtonClassName}
                disabled={isPending("shareholder-save")}
                onClick={() => void saveShareholder()}
              >
                {isPending("shareholder-save") ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className={secondaryButtonClassName}
                disabled={isPending("shareholder-save")}
                onClick={() => {
                  setShareholderFormOpen(false);
                  resetShareholderForm();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>
      ) : null}

      {showDeclarations ? (
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#0f2744]">Declarations</h3>
          {canManage ? (
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={() => openNewDeclarationForm()}
            >
              New declaration
            </button>
          ) : null}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <ul className="max-h-80 divide-y divide-slate-200 overflow-y-auto text-sm">
            {declarations.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={`w-full px-2 py-3 text-left hover:bg-slate-50 ${
                    selectedDeclarationId === row.id ? "bg-slate-100" : ""
                  }`}
                  onClick={() => setSelectedDeclarationId(row.id)}
                >
                  <p className="font-medium text-slate-900">{row.declaration_number}</p>
                  <p className="text-slate-600">
                    {formatDate(row.declaration_date)} · {row.status} · gross{" "}
                    {formatGHS(row.gross_amount)}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div className="rounded-md border border-slate-200 p-4 text-sm">
            {selectedDeclaration ? (
              <>
                <p className="font-semibold text-[#0f2744]">
                  {selectedDeclaration.declaration_number}
                </p>
                <p className="mt-1 text-slate-600">
                  {selectedDeclaration.status === "cancelled" ? (
                    <>
                      Cancelled{" "}
                      {selectedDeclaration.cancelled_at
                        ? formatDate(selectedDeclaration.cancelled_at)
                        : "—"}{" "}
                      — Reason:{" "}
                      {selectedDeclaration.cancel_reason?.trim() || "—"}
                    </>
                  ) : (
                    <>
                      Declared {formatDate(selectedDeclaration.declaration_date)} ·{" "}
                      {selectedDeclaration.status}
                    </>
                  )}
                </p>
                <dl className="mt-3 grid gap-1 text-slate-700">
                  <div>
                    <dt className="inline font-medium">Profit period: </dt>
                    <dd className="inline">
                      {formatDate(selectedDeclaration.period_start)} –{" "}
                      {formatDate(selectedDeclaration.period_end)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Resolution: </dt>
                    <dd className="inline">
                      {selectedDeclaration.resolution_reference?.trim() || "—"}
                    </dd>
                  </div>
                  {selectedDeclaration.resolution_notes?.trim() ? (
                    <div>
                      <dt className="inline font-medium">Notes: </dt>
                      <dd className="inline">
                        {selectedDeclaration.resolution_notes.trim()}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="inline font-medium">Amounts: </dt>
                    <dd className="inline">
                      Gross {formatGHS(selectedDeclaration.gross_amount)} · WHT{" "}
                      {formatGHS(selectedDeclaration.wht_amount)} · Net{" "}
                      {formatGHS(selectedDeclaration.net_amount)}
                    </dd>
                  </div>
                </dl>
                <ul className="mt-4 space-y-2">
                  {selectedLines.map((line) => (
                    <li
                      key={line.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2"
                    >
                      <span>
                        {line.payee_name} — net {formatGHS(line.net_amount)}
                        {lineFullyPaid(line) ? (
                          <>
                            {" "}
                            · Paid{" "}
                            {line.payment_date
                              ? formatDate(line.payment_date)
                              : "—"}{" "}
                            · {formatShareholderPaymentMethod(line.payment_method)} ·{" "}
                            {line.payment_reference?.trim() || "—"}
                          </>
                        ) : (
                          <> (paid {formatGHS(line.paid_amount)})</>
                        )}
                      </span>
                      {canManage &&
                      selectedDeclaration.status !== "cancelled" &&
                      selectedDeclaration.status !== "paid" &&
                      selectedDeclaration.status !== "draft" &&
                      !lineFullyPaid(line) ? (
                        <button
                          type="button"
                          className={secondaryButtonClassName}
                          disabled={isPending("record-payment")}
                          onClick={() => openPaymentModal(line)}
                        >
                          {isPending("record-payment") ? "Saving…" : "Record payment"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {canManage && selectedDeclaration.status === "declared" ? (
                  <div className="mt-4">
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      disabled={isPending(`cancel-declaration:${selectedDeclaration.id}`)}
                      onClick={() => void cancelDeclared(selectedDeclaration.id)}
                    >
                      {isPending(`cancel-declaration:${selectedDeclaration.id}`)
                        ? "Cancelling…"
                        : "Cancel declaration"}
                    </button>
                  </div>
                ) : null}
                {canManage && selectedDeclaration.status === "draft" ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      onClick={() => openEditDraftForm(selectedDeclaration)}
                    >
                      Edit draft
                    </button>
                    <button
                      type="button"
                      className={primaryButtonClassName}
                      disabled={isPending(`declare:${selectedDeclaration.id}`)}
                      onClick={() => void declareDraft(selectedDeclaration.id)}
                    >
                      {isPending(`declare:${selectedDeclaration.id}`)
                        ? "Declaring…"
                        : "Declare"}
                    </button>
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      disabled={isPending(`draft-delete:${selectedDeclaration.id}`)}
                      onClick={() => void deleteDraft(selectedDeclaration.id)}
                    >
                      {isPending(`draft-delete:${selectedDeclaration.id}`)
                        ? "Deleting…"
                        : "Delete draft"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-slate-600">Select a declaration to view lines.</p>
            )}
          </div>
        </div>

        {declareFormOpen && canManage ? (
          <form
            ref={declareFormRef}
            className="mt-6 grid gap-4 border-t border-slate-200 pt-6 md:grid-cols-2"
            onSubmit={(e) => e.preventDefault()}
          >
            <p className="md:col-span-2 text-sm font-medium text-[#0f2744]">
              {editingDraftId ? "Edit draft declaration" : "New draft declaration"}
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Declaration date
              </label>
              <input
                type="date"
                required
                className={inputClassName}
                value={declareForm.declaration_date}
                onChange={(e) => {
                  const date = e.target.value;
                  const q = priorCompletedQuarterBounds(date);
                  setDeclareForm((f) => ({
                    ...f,
                    declaration_date: date,
                    period_start: q.start,
                    period_end: q.end,
                  }));
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Gross amount (GHS)
              </label>
              <input
                required
                className={inputClassName}
                value={declareForm.gross_amount}
                onChange={(e) =>
                  setDeclareForm((f) => ({ ...f, gross_amount: e.target.value }))
                }
                aria-invalid={Boolean(declareFieldErrors.gross_amount)}
              />
              {declareFieldErrors.gross_amount ? (
                <p className="mt-1 text-xs text-red-700">{declareFieldErrors.gross_amount}</p>
              ) : null}
              <p className="mt-1 text-xs text-slate-600">
                WHT {formatGHS(whtPreview)} · Net {formatGHS(netPreview)}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Profit period start
              </label>
              <input
                type="date"
                required
                className={inputClassName}
                value={declareForm.period_start}
                onChange={(e) =>
                  setDeclareForm((f) => ({ ...f, period_start: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Profit period end
              </label>
              <input
                ref={periodEndRef}
                type="date"
                required
                className={inputClassName}
                value={declareForm.period_end}
                min={declareForm.period_start || undefined}
                onChange={(e) =>
                  setDeclareForm((f) => ({ ...f, period_end: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Resolution reference
              </label>
              <input
                className={inputClassName}
                value={declareForm.resolution_reference}
                onChange={(e) =>
                  setDeclareForm((f) => ({
                    ...f,
                    resolution_reference: e.target.value,
                  }))
                }
                placeholder="Required before Declare; optional for Save draft"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Notes (optional)
              </label>
              <textarea
                className={`${inputClassName} min-h-[4.5rem]`}
                value={declareForm.resolution_notes}
                onChange={(e) =>
                  setDeclareForm((f) => ({ ...f, resolution_notes: e.target.value }))
                }
              />
            </div>
            {declareContext ? (
              <div className="md:col-span-2 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 sm:grid-cols-3">
                <p>
                  Retained earnings to date:{" "}
                  <span className="font-medium tabular-nums">
                    {declareContext.retainedEarnings != null
                      ? formatGHS(declareContext.retainedEarnings)
                      : "—"}
                  </span>
                </p>
                <p>
                  Dividend available this quarter:{" "}
                  <span className="font-medium tabular-nums">
                    {declareContext.dividendAvailable != null
                      ? formatGHS(declareContext.dividendAvailable)
                      : "—"}
                  </span>
                </p>
                <p>
                  Declared this quarter:{" "}
                  <span className="font-medium tabular-nums">
                    {declareContext.declaredThisQuarter != null
                      ? formatGHS(declareContext.declaredThisQuarter)
                      : "—"}
                  </span>
                </p>
              </div>
            ) : null}
            <div className="md:col-span-2 flex gap-2">
              <button
                type="button"
                className={primaryButtonClassName}
                disabled={isPending("draft-save")}
                onClick={() => void saveDraftDeclaration()}
              >
                {isPending("draft-save") ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                className={secondaryButtonClassName}
                disabled={isPending("draft-save")}
                onClick={() => {
                  setDeclareFormOpen(false);
                  setEditingDraftId(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>
      ) : null}

      {paymentLine ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-[#0f2744]">Record payment</h3>
            <p className="mt-1 text-sm text-slate-600">{paymentLine.payee_name}</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment date
                </label>
                <input
                  type="date"
                  className={inputClassName}
                  value={paymentForm.payment_date}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Method
                </label>
                <select
                  className={inputClassName}
                  value={paymentForm.payment_method}
                  onChange={(e) =>
                    setPaymentForm((f) => ({
                      ...f,
                      payment_method: e.target.value as ShareholderPaymentMethod,
                    }))
                  }
                >
                  <option value="bank">Bank</option>
                  <option value="momo">MoMo</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Reference
                </label>
                <input
                  className={inputClassName}
                  value={paymentForm.payment_reference}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, payment_reference: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Net payment (GHS)
                </label>
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900">
                  {formatGHS(Number(paymentLine.net_amount) || 0)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Each line is paid in full in one payment.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className={secondaryButtonClassName}
                disabled={isPending("record-payment")}
                onClick={() => setPaymentLine(null)}
              >
                Close
              </button>
              <button
                type="button"
                className={primaryButtonClassName}
                disabled={isPending("record-payment")}
                onClick={() => void submitPayment()}
              >
                {isPending("record-payment") ? "Saving…" : "Save payment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
