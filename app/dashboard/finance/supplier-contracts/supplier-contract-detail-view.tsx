"use client";

import { confirmDialog } from "@/components/feedback/app-dialogs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import {
  useBusinessUnitView,
  useStampBusinessUnitId,
} from "@/app/dashboard/business-unit-view-context";
import { inputClassName } from "@/app/dashboard/employees/employee-record-utils";
import {
  calculateDaysOutstanding,
  calculateStatus,
  formatGHS,
  getRemainingPayableBalance,
} from "../accounts-payable-utils";
import {
  SUPPLIER_CONTRACT_DOCUMENT_ACCEPT,
  SUPPLIER_CONTRACT_DOCUMENT_HINT,
} from "@/utils/supplier-contract-document";
import { createClient } from "@/utils/supabase/client";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  normalizeSupplierContractStatus,
  formatSupplierContractCurrentMonthlyAmountDisplay,
  resolveSupplierContractDisplayStatus,
  supplierContractDisplayStatusBadgeClassName,
  type SupplierContractStatus,
} from "@/utils/supplier-contracts-types";

type DetailPayload = {
  contract: Record<string, unknown>;
  amendments: Array<Record<string, unknown>>;
  deductions: Array<Record<string, unknown>>;
  payables: Array<Record<string, unknown>>;
  business_unit_name?: string | null;
  document_signed_url?: string | null;
};

const primaryBtn =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50";
const secondaryBtn =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50";

function agreementTypeLabel(value: unknown): string {
  const v = String(value ?? "").toLowerCase();
  return v === "written" ? "Written" : "Verbal";
}

export default function SupplierContractDetailView({ contractId }: { contractId: string }) {
  const router = useRouter();
  const { units } = useBusinessUnitView();
  const stampBusinessUnit = useStampBusinessUnitId();
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingAmendDoc, setPendingAmendDoc] = useState<File[]>([]);
  const [pendingContractDoc, setPendingContractDoc] = useState<File[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<Array<{ name: string }>>([]);
  const [editOpen, setEditOpen] = useState(false);

  const [amendForm, setAmendForm] = useState({
    effective_date: "",
    new_monthly_amount: "",
    change_reason: "",
  });

  const [replacementForm, setReplacementForm] = useState({
    service_date: "",
    replacement_name: "",
    amount: "",
    payment_method: "company_cash",
    notes: "",
  });

  const [editForm, setEditForm] = useState({
    end_date: "",
    auto_renew: false,
    mid_month_reminder_enabled: false,
    mid_month_reminder_day: "15",
    notes: "",
    business_unit_id: "",
  });

  const loadDetail = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/supplier-contracts/${contractId}`);
    const payload = (await response.json()) as DetailPayload & { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Unable to load contract.");
      setDetail(null);
      return;
    }
    setDetail(payload);
    const c = payload.contract;
    setEditForm({
      end_date: String(c.end_date ?? "").slice(0, 10),
      auto_renew: Boolean(c.auto_renew),
      mid_month_reminder_enabled: Boolean(c.mid_month_reminder_enabled),
      mid_month_reminder_day: String(c.mid_month_reminder_day ?? 15),
      notes: String(c.notes ?? ""),
      business_unit_id: String(c.business_unit_id ?? ""),
    });
  }, [contractId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadDetail().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadDetail]);

  useEffect(() => {
    if (loading || !detail) {
      return;
    }
    const terminated =
      normalizeSupplierContractStatus(String(detail.contract.status)) ===
      "terminated";
    if (terminated) {
      return;
    }
    if (window.location.hash === "#supplier-contract-edit") {
      setEditOpen(true);
    }
  }, [loading, detail]);

  useEffect(() => {
    const client = createClient();
    void client
      .from("payment_methods")
      .select("name")
      .order("name", { ascending: true })
      .then(({ data }) => {
        if (data?.length) {
          setPaymentMethods(data as Array<{ name: string }>);
        }
      });
  }, []);

  const contractStatus = detail
    ? normalizeSupplierContractStatus(String(detail.contract.status))
    : "draft";
  const isTerminated = contractStatus === "terminated";
  const canEdit = !isTerminated;
  const hasGeneratedAp = (detail?.payables.length ?? 0) > 0;

  const displayStatus = detail
    ? resolveSupplierContractDisplayStatus({
        status: String(detail.contract.status),
        end_date: String(detail.contract.end_date ?? ""),
      })
    : "Draft";

  const currentMonthlyAmountDisplay = useMemo(() => {
    if (!detail) return "—";
    const amendments = detail.amendments.map((row) => ({
      effective_date: String(row.effective_date),
      new_monthly_amount: Number(row.new_monthly_amount),
    }));
    return formatSupplierContractCurrentMonthlyAmountDisplay(amendments);
  }, [detail]);

  async function uploadDocument(
    file: File,
    amendmentId?: string | null,
  ): Promise<void> {
    const fd = new FormData();
    fd.set("contract_id", contractId);
    fd.set("file", file);
    if (amendmentId) {
      fd.set("amendment_id", amendmentId);
    }
    const response = await fetch("/api/supplier-contracts/upload-document", {
      method: "POST",
      body: fd,
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Document upload failed.");
    }
  }

  async function activateContract() {
    if (
      !(await confirmDialog({
        message:
          "Activate this supplier contract? Monthly billing will follow the contract schedule.",
      }))
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/supplier-contracts/${contractId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Activation failed.");
      setSaving(false);
      return;
    }
    await loadDetail();
    router.refresh();
    setSaving(false);
  }

  async function submitEdit() {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      end_date: editForm.end_date,
      auto_renew: editForm.auto_renew,
      mid_month_reminder_enabled: editForm.mid_month_reminder_enabled,
      mid_month_reminder_day: Number(editForm.mid_month_reminder_day) || 15,
      notes: editForm.notes || null,
    };
    if (!hasGeneratedAp && units.length > 0) {
      body.business_unit_id = editForm.business_unit_id.trim() || null;
    }
    const response = await fetch(`/api/supplier-contracts/${contractId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Update failed.");
      setSaving(false);
      return;
    }
    if (pendingContractDoc[0]) {
      try {
        await uploadDocument(pendingContractDoc[0]);
        setPendingContractDoc([]);
      } catch (uploadErr) {
        setError(
          uploadErr instanceof Error ? uploadErr.message : "Document upload failed.",
        );
        setSaving(false);
        return;
      }
    }
    await loadDetail();
    setEditOpen(false);
    setSaving(false);
    router.refresh();
  }

  async function submitAmendment() {
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/supplier-contracts/${contractId}/amendments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        effective_date: amendForm.effective_date,
        new_monthly_amount: Number(amendForm.new_monthly_amount),
        change_reason: amendForm.change_reason,
      }),
    });
    const payload = (await response.json()) as {
      error?: string;
      amendment_id?: string;
    };
    if (!response.ok) {
      setError(payload.error ?? "Amendment failed.");
      setSaving(false);
      return;
    }
    if (pendingAmendDoc[0] && payload.amendment_id) {
      try {
        await uploadDocument(pendingAmendDoc[0], payload.amendment_id);
        setPendingAmendDoc([]);
      } catch (uploadErr) {
        setError(
          uploadErr instanceof Error ? uploadErr.message : "Amendment document upload failed.",
        );
        setSaving(false);
        return;
      }
    }
    await loadDetail();
    setSaving(false);
  }

  async function submitReplacement() {
    setSaving(true);
    setError(null);
    const response = await fetch(
      `/api/supplier-contracts/${contractId}/replacement-payment`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_date: replacementForm.service_date,
          replacement_name: replacementForm.replacement_name,
          amount: Number(replacementForm.amount),
          payment_method: replacementForm.payment_method,
          notes: replacementForm.notes || null,
        }),
      },
    );
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Replacement payment failed.");
      setSaving(false);
      return;
    }
    setReplacementForm({
      service_date: "",
      replacement_name: "",
      amount: "",
      payment_method: replacementForm.payment_method,
      notes: "",
    });
    await loadDetail();
    setSaving(false);
  }

  async function terminateContract() {
    if (!detail?.contract) return;
    const creditBalance = Number(detail.contract.credit_balance) || 0;
    const creditWarning =
      creditBalance > 0
        ? `\n\nSupplier owes ${formatInvoiceMoney(creditBalance)} of unused credit. This will be recorded in the contract notes. Generated accounts payable are kept as real obligations; only future billing stops.`
        : "\n\nGenerated accounts payable are kept as real obligations; only future billing stops.";
    if (
      !(await confirmDialog({
        message: "Terminate this contract?",
        detail: creditWarning.replace(/^\n\n/, ""),
      }))
    ) {
      return;
    }
    const response = await fetch(`/api/supplier-contracts/${contractId}/terminate`, {
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Terminate failed.");
      return;
    }
    await loadDetail();
    router.refresh();
  }

  if (loading) {
    return <p className="text-sm text-slate-600">Loading contract…</p>;
  }

  if (!detail) {
    return (
      <p className="text-sm text-red-700">{error ?? "Contract not found."}</p>
    );
  }

  const contract = detail.contract;
  const status = normalizeSupplierContractStatus(String(contract.status)) as SupplierContractStatus;

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[#0f2744]">Supplier contract</h3>
          <p className="text-sm text-slate-600">
            Credit balance: {formatInvoiceMoney(Number(contract.credit_balance) || 0)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status === "draft" ? (
            <button
              type="button"
              className={primaryBtn}
              disabled={saving}
              onClick={activateContract}
            >
              Activate
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => setEditOpen((open) => !open)}
            >
              {editOpen ? "Close edit" : "Edit contract"}
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" className={secondaryBtn} onClick={terminateContract}>
              Terminate
            </button>
          ) : null}
          <Link href="/dashboard/finance/supplier-contracts" className={secondaryBtn}>
            Back to list
          </Link>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium ${supplierContractDisplayStatusBadgeClassName(displayStatus)}`}
          >
            {displayStatus}
          </span>
        </div>
        <dl className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-slate-500">Supplier</dt>
            <dd className="font-medium text-[#0f2744]">{String(contract.supplier_name)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Contract number</dt>
            <dd className="font-medium">{String(contract.contract_number)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Agreement type</dt>
            <dd>{agreementTypeLabel(contract.agreement_type)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Start date</dt>
            <dd>{formatInvoiceDate(String(contract.start_date))}</dd>
          </div>
          <div>
            <dt className="text-slate-500">End date</dt>
            <dd>{formatInvoiceDate(String(contract.end_date))}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Auto-renew</dt>
            <dd>{contract.auto_renew ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Category</dt>
            <dd>
              {String(contract.expense_category)} / {String(contract.sub_category)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">WHT rate</dt>
            <dd>{Number(contract.wht_rate) || 0}%</dd>
          </div>
          <div>
            <dt className="text-slate-500">Business unit</dt>
            <dd>{detail.business_unit_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Mid-month reminder</dt>
            <dd>
              {contract.mid_month_reminder_enabled
                ? `On (day ${String(contract.mid_month_reminder_day)})`
                : "Off"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Next billing date</dt>
            <dd>
              {contract.next_billing_date
                ? formatInvoiceDate(String(contract.next_billing_date))
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Current monthly amount</dt>
            <dd className="font-medium">{currentMonthlyAmountDisplay}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-slate-500">Document</dt>
            <dd>
              {detail.document_signed_url ? (
                <a
                  href={detail.document_signed_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[#0f2744] underline"
                >
                  View agreement document
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
          {contract.notes ? (
            <div className="md:col-span-3">
              <dt className="text-slate-500">Notes</dt>
              <dd className="whitespace-pre-wrap">{String(contract.notes)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {editOpen && canEdit ? (
        <section
          id="supplier-contract-edit"
          className="rounded-lg border border-slate-200 p-4"
        >
          <h4 className="mb-3 font-medium">Edit contract settings</h4>
          <p className="mb-3 text-sm text-slate-600">
            Monthly amount changes use Change amount below. Terminated contracts cannot be edited.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">
              End date
              <input
                type="date"
                className={`${inputClassName} mt-1 w-full`}
                value={editForm.end_date}
                onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
              />
            </label>
            {!hasGeneratedAp && units.length > 0 ? (
              <label className="block text-sm">
                Business unit
                <select
                  className={`${inputClassName} mt-1 w-full`}
                  value={editForm.business_unit_id}
                  onChange={(e) =>
                    setEditForm({ ...editForm, business_unit_id: e.target.value })
                  }
                  required
                >
                  <option value="">Select</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={editForm.auto_renew}
                onChange={(e) => setEditForm({ ...editForm, auto_renew: e.target.checked })}
              />
              Auto-renew
            </label>
            <label className="flex flex-wrap items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={editForm.mid_month_reminder_enabled}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    mid_month_reminder_enabled: e.target.checked,
                  })
                }
              />
              Mid-month reminder
              <input
                type="number"
                min={1}
                max={28}
                className={`${inputClassName} w-16`}
                value={editForm.mid_month_reminder_day}
                onChange={(e) =>
                  setEditForm({ ...editForm, mid_month_reminder_day: e.target.value })
                }
              />
            </label>
            <label className="block text-sm md:col-span-2">
              Notes
              <textarea
                className={`${inputClassName} mt-1 w-full`}
                rows={3}
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </label>
            <div className="text-sm md:col-span-2">
              <span className="mb-1 block font-medium">Replace agreement document</span>
              <ImageFileUploadButton
                files={pendingContractDoc}
                onChange={setPendingContractDoc}
                multiple={false}
                accept={SUPPLIER_CONTRACT_DOCUMENT_ACCEPT}
                emptyHint={SUPPLIER_CONTRACT_DOCUMENT_HINT}
                addLabel="Upload document"
              />
            </div>
          </div>
          <button
            type="button"
            className={`${primaryBtn} mt-4`}
            disabled={saving || (units.length > 0 && !stampBusinessUnit.ok && !hasGeneratedAp)}
            onClick={submitEdit}
          >
            Save settings
          </button>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 p-4">
        <h4 className="mb-3 font-medium">Monthly bills (Accounts Payable)</h4>
        {detail.payables.length === 0 ? (
          <p className="text-sm text-slate-600">
            The first bill is created automatically on the 1st of the contract&apos;s start month.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-3 py-2">Month</th>
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Paid</th>
                  <th className="px-3 py-2">Balance</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">AP entry</th>
                </tr>
              </thead>
              <tbody>
                {detail.payables.map((ap) => {
                  const amount = Number(ap.amount) || 0;
                  const paid = Number(ap.amount_paid) || 0;
                  const balance = getRemainingPayableBalance({
                    amount,
                    amount_paid: paid,
                    balance_due:
                      ap.balance_due == null ? null : Number(ap.balance_due) || 0,
                  });
                  const daysOutstanding = calculateDaysOutstanding(
                    String(ap.due_date ?? ap.invoice_date),
                  );
                  const payableStatus = calculateStatus(balance, daysOutstanding);
                  const monthLabel = String(ap.invoice_date ?? "").slice(0, 7);
                  const apId = String(ap.id);
                  return (
                    <tr key={apId} className="border-t border-slate-100">
                      <td className="px-3 py-2">{monthLabel}</td>
                      <td className="px-3 py-2">{String(ap.invoice_number)}</td>
                      <td className="px-3 py-2">{formatGHS(amount)}</td>
                      <td className="px-3 py-2">{formatGHS(paid)}</td>
                      <td className="px-3 py-2">{formatGHS(balance)}</td>
                      <td className="px-3 py-2">{payableStatus}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/dashboard/finance/accounts-payable#ap-${apId}`}
                          className="font-medium text-[#0f2744] hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit ? (
        <section className="rounded-lg border border-slate-200 p-4">
          <h4 className="mb-3 font-medium">Change amount</h4>
          <ul className="mb-3 space-y-2 text-sm">
            {detail.amendments.map((row) => (
              <li key={String(row.id)}>
                {formatInvoiceDate(String(row.effective_date))}: GHS{" "}
                {Number(row.new_monthly_amount).toFixed(2)} — {String(row.change_reason)}
              </li>
            ))}
          </ul>
          <div className="grid gap-2 md:grid-cols-3">
            <input
              type="date"
              className={inputClassName}
              value={amendForm.effective_date}
              onChange={(e) =>
                setAmendForm({ ...amendForm, effective_date: e.target.value })
              }
            />
            <input
              type="number"
              placeholder="New monthly amount"
              className={inputClassName}
              value={amendForm.new_monthly_amount}
              onChange={(e) =>
                setAmendForm({ ...amendForm, new_monthly_amount: e.target.value })
              }
            />
            <input
              placeholder="Reason"
              className={inputClassName}
              value={amendForm.change_reason}
              onChange={(e) =>
                setAmendForm({ ...amendForm, change_reason: e.target.value })
              }
            />
          </div>
          <div className="mt-3 space-y-2">
            <ImageFileUploadButton
              files={pendingAmendDoc}
              onChange={setPendingAmendDoc}
              multiple={false}
              accept={SUPPLIER_CONTRACT_DOCUMENT_ACCEPT}
              emptyHint={SUPPLIER_CONTRACT_DOCUMENT_HINT}
              addLabel="Optional amendment document"
            />
            <button type="button" className={primaryBtn} disabled={saving} onClick={submitAmendment}>
              Save change amount
            </button>
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <section className="rounded-lg border border-slate-200 p-4">
          <h4 className="mb-3 font-medium">Record replacement payment</h4>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="block text-sm">
              Service date
              <input
                type="date"
                className={`${inputClassName} mt-1 w-full`}
                value={replacementForm.service_date}
                onChange={(e) =>
                  setReplacementForm({ ...replacementForm, service_date: e.target.value })
                }
              />
            </label>
            <label className="block text-sm">
              Replacement name
              <input
                className={`${inputClassName} mt-1 w-full`}
                value={replacementForm.replacement_name}
                onChange={(e) =>
                  setReplacementForm({
                    ...replacementForm,
                    replacement_name: e.target.value,
                  })
                }
              />
            </label>
            <label className="block text-sm">
              Amount (GHS)
              <input
                type="number"
                className={`${inputClassName} mt-1 w-full`}
                value={replacementForm.amount}
                onChange={(e) =>
                  setReplacementForm({ ...replacementForm, amount: e.target.value })
                }
              />
            </label>
            <label className="block text-sm">
              Payment method
              <select
                className={`${inputClassName} mt-1 w-full`}
                value={replacementForm.payment_method}
                onChange={(e) =>
                  setReplacementForm({
                    ...replacementForm,
                    payment_method: e.target.value,
                  })
                }
              >
                {paymentMethods.length === 0 ? (
                  <option value="company_cash">company_cash</option>
                ) : (
                  paymentMethods.map((method) => (
                    <option key={method.name} value={method.name}>
                      {method.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="block text-sm md:col-span-2">
              Notes
              <textarea
                className={`${inputClassName} mt-1 w-full`}
                rows={2}
                value={replacementForm.notes}
                onChange={(e) =>
                  setReplacementForm({ ...replacementForm, notes: e.target.value })
                }
              />
            </label>
          </div>
          <button
            type="button"
            className={`${primaryBtn} mt-3`}
            disabled={saving}
            onClick={submitReplacement}
          >
            Record replacement
          </button>
          <h4 className="mb-2 mt-6 font-medium">Deductions</h4>
          <ul className="space-y-1 text-sm">
            {detail.deductions.map((d) => (
              <li key={String(d.id)}>
                {String(d.service_date)} — applied {Number(d.amount_applied).toFixed(2)}, carried{" "}
                {Number(d.amount_carried_forward).toFixed(2)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
