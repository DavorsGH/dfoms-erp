"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import type { NamedLookup } from "@/app/dashboard/lookup-types";
import { inputClassName } from "@/app/dashboard/employees/employee-record-utils";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  formatSupplierContractStatus,
  isSupplierContractRenewalDue,
  supplierContractStatusBadgeClassName,
  type SupplierContractListRow,
  type SupplierAgreementType,
} from "@/utils/supplier-contracts-types";

type SupplierOption = { id: string; name: string };

type WorkspaceMode = "list" | "create" | "detail";

type DetailPayload = {
  contract: Record<string, unknown>;
  amendments: Array<Record<string, unknown>>;
  deductions: Array<Record<string, unknown>>;
  payables: Array<Record<string, unknown>>;
};

const primaryBtn =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50";
const secondaryBtn =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50";

export default function SupplierContractsWorkspace({
  initialContracts,
  expenseCategories,
  expenseSubcategories,
  detailId = null,
  initialMode = "list",
}: {
  initialContracts: SupplierContractListRow[];
  expenseCategories: NamedLookup[];
  expenseSubcategories: NamedLookup[];
  detailId?: string | null;
  initialMode?: WorkspaceMode;
}) {
  const router = useRouter();
  const [contracts, setContracts] = useState(initialContracts);
  const [mode, setMode] = useState<WorkspaceMode>(
    detailId ? "detail" : initialMode,
  );
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [pendingDoc, setPendingDoc] = useState<File[]>([]);
  const [pendingAmendDoc, setPendingAmendDoc] = useState<File[]>([]);

  const [form, setForm] = useState({
    supplier_id: "",
    agreement_type: "verbal" as SupplierAgreementType,
    document_url: "",
    start_date: "",
    end_date: "",
    auto_renew: false,
    status: "active",
    expense_category: "",
    sub_category: "",
    wht_rate: "0",
    initial_monthly_amount: "",
    mid_month_reminder_enabled: false,
    mid_month_reminder_day: "15",
    notes: "",
  });

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

  useEffect(() => {
    setContracts(initialContracts);
  }, [initialContracts]);

  useEffect(() => {
    void fetch("/api/finance/suppliers")
      .then((r) => r.json())
      .then((payload) => {
        setSuppliers(
          ((payload.suppliers as SupplierOption[] | undefined) ?? []).map((s) => ({
            id: s.id,
            name: s.name,
          })),
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!detailId) {
      setMode("list");
      return;
    }
    setMode("detail");
    void loadDetail(detailId);
  }, [detailId]);


  async function loadDetail(id: string) {
    setError(null);
    const response = await fetch(`/api/supplier-contracts/${id}`);
    const payload = (await response.json()) as DetailPayload & { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Unable to load contract.");
      return;
    }
    setDetail(payload);
  }

  async function addSupplierInline() {
    const name = newSupplierName.trim();
    if (!name) return;
    const response = await fetch("/api/finance/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const payload = (await response.json()) as {
      supplier?: SupplierOption;
      error?: string;
    };
    if (!response.ok || !payload.supplier) {
      setError(payload.error ?? "Unable to add supplier.");
      return;
    }
    setSuppliers((current) => [...current, payload.supplier!]);
    setForm((current) => ({ ...current, supplier_id: payload.supplier!.id }));
    setNewSupplierName("");
  }

  async function uploadDocument(
    contractId: string,
    file: File,
    amendmentId?: string | null,
  ): Promise<string | null> {
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
    const payload = (await response.json()) as { document_url?: string; error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Document upload failed.");
    }
    return payload.document_url ?? null;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (form.agreement_type === "written" && pendingDoc.length === 0) {
        throw new Error("Written agreements require an uploaded document.");
      }
      const createAsDraft =
        form.agreement_type === "written" && pendingDoc.length > 0;
      const createRes = await fetch("/api/supplier-contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          status: createAsDraft ? "draft" : form.status,
          wht_rate: Number(form.wht_rate) || 0,
          initial_monthly_amount: Number(form.initial_monthly_amount),
          mid_month_reminder_day: Number(form.mid_month_reminder_day) || 15,
          document_url: null,
        }),
      });
      const created = (await createRes.json()) as {
        contract?: { id: string };
        error?: string;
      };
      if (!createRes.ok || !created.contract) {
        throw new Error(created.error ?? "Create failed.");
      }
      if (form.agreement_type === "written" && pendingDoc[0]) {
        await uploadDocument(created.contract.id, pendingDoc[0]);
        const activateRes = await fetch(
          `/api/supplier-contracts/${created.contract.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "active" }),
          },
        );
        const activatePayload = (await activateRes.json()) as { error?: string };
        if (!activateRes.ok) {
          throw new Error(activatePayload.error ?? "Unable to activate contract.");
        }
      }
      router.push(`/dashboard/finance/supplier-contracts/${created.contract.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setSaving(false);
    }
  }

  async function submitAmendment() {
    if (!detailId) return;
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/supplier-contracts/${detailId}/amendments`, {
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
        await uploadDocument(detailId, pendingAmendDoc[0], payload.amendment_id);
        setPendingAmendDoc([]);
      } catch (uploadErr) {
        setError(
          uploadErr instanceof Error ? uploadErr.message : "Amendment document upload failed.",
        );
        setSaving(false);
        return;
      }
    }
    await loadDetail(detailId);
    setSaving(false);
  }

  async function submitReplacement() {
    if (!detailId) return;
    setSaving(true);
    setError(null);
    const response = await fetch(
      `/api/supplier-contracts/${detailId}/replacement-payment`,
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
    await loadDetail(detailId);
    setSaving(false);
  }

  async function terminateContract() {
    if (!detailId || !detail?.contract) return;
    const creditBalance = Number(detail.contract.credit_balance) || 0;
    const creditWarning =
      creditBalance > 0
        ? `\n\nSupplier owes ${formatInvoiceMoney(creditBalance)} of unused credit. This will be recorded in the contract notes. Generated accounts payable are kept as real obligations; only future billing stops.`
        : "\n\nGenerated accounts payable are kept as real obligations; only future billing stops.";
    if (!window.confirm(`Terminate this contract?${creditWarning}`)) return;
    const response = await fetch(`/api/supplier-contracts/${detailId}/terminate`, {
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Terminate failed.");
      return;
    }
    await loadDetail(detailId);
    router.refresh();
  }

  if (mode === "create") {
    return (
      <div className="space-y-4">
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <form onSubmit={handleCreate} className="space-y-4 rounded-lg border border-slate-200 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              Supplier
              <select
                className={`${inputClassName} mt-1 w-full`}
                value={form.supplier_id}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                required
              >
                <option value="">Select supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <label className="block flex-1 text-sm">
                Add new supplier
                <input
                  className={`${inputClassName} mt-1 w-full`}
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                />
              </label>
              <button type="button" className={secondaryBtn} onClick={addSupplierInline}>
                Add
              </button>
            </div>
            <label className="block text-sm">
              Agreement type
              <select
                className={`${inputClassName} mt-1 w-full`}
                value={form.agreement_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    agreement_type: e.target.value as SupplierAgreementType,
                  })
                }
              >
                <option value="verbal">Verbal</option>
                <option value="written">Written</option>
              </select>
            </label>
            {form.agreement_type === "written" ? (
              <div className="text-sm">
                <span className="mb-1 block font-medium">Agreement document</span>
                <ImageFileUploadButton
                  files={pendingDoc}
                  onChange={setPendingDoc}
                  multiple={false}
                  accept=".pdf,image/*"
                  addLabel="Upload document"
                />
              </div>
            ) : null}
            <label className="block text-sm">
              Start date
              <input
                type="date"
                className={`${inputClassName} mt-1 w-full`}
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                required
              />
            </label>
            <label className="block text-sm">
              End date
              <input
                type="date"
                className={`${inputClassName} mt-1 w-full`}
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                required
              />
            </label>
            <label className="block text-sm">
              Initial monthly amount (GHS)
              <input
                type="number"
                min="0"
                step="0.01"
                className={`${inputClassName} mt-1 w-full`}
                value={form.initial_monthly_amount}
                onChange={(e) =>
                  setForm({ ...form, initial_monthly_amount: e.target.value })
                }
                required
              />
            </label>
            <label className="block text-sm">
              WHT rate (%)
              <input
                type="number"
                min="0"
                step="0.01"
                className={`${inputClassName} mt-1 w-full`}
                value={form.wht_rate}
                onChange={(e) => setForm({ ...form, wht_rate: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              Category
              <select
                className={`${inputClassName} mt-1 w-full`}
                value={form.expense_category}
                onChange={(e) =>
                  setForm({ ...form, expense_category: e.target.value, sub_category: "" })
                }
                required
              >
                <option value="">Select</option>
                {expenseCategories.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Sub-category
              <select
                className={`${inputClassName} mt-1 w-full`}
                value={form.sub_category}
                onChange={(e) => setForm({ ...form, sub_category: e.target.value })}
                required
              >
                <option value="">Select</option>
                {expenseSubcategories.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.auto_renew}
              onChange={(e) => setForm({ ...form, auto_renew: e.target.checked })}
            />
            Auto-renew
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.mid_month_reminder_enabled}
              onChange={(e) =>
                setForm({ ...form, mid_month_reminder_enabled: e.target.checked })
              }
            />
            Mid-month reminder
            <input
              type="number"
              min={1}
              max={28}
              className={`${inputClassName} w-16`}
              value={form.mid_month_reminder_day}
              onChange={(e) =>
                setForm({ ...form, mid_month_reminder_day: e.target.value })
              }
            />
          </label>
          <div className="flex gap-3">
            <button type="submit" className={primaryBtn} disabled={saving}>
              {saving ? "Saving…" : "Create contract"}
            </button>
            <Link href="/dashboard/finance/supplier-contracts" className={secondaryBtn}>
              Cancel
            </Link>
          </div>
        </form>
      </div>
    );
  }

  if (mode === "detail" && detail) {
    const contract = detail.contract;
    return (
      <div className="space-y-6">
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#0f2744]">
              {String(contract.supplier_name)} — {String(contract.contract_number)}
            </h3>
            <p className="text-sm text-slate-600">
              Credit balance: {formatInvoiceMoney(Number(contract.credit_balance) || 0)}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" className={secondaryBtn} onClick={terminateContract}>
              Terminate
            </button>
            <Link href="/dashboard/finance/supplier-contracts" className={secondaryBtn}>
              Back to list
            </Link>
          </div>
        </div>

        <section className="rounded-lg border border-slate-200 p-4">
          <h4 className="mb-3 font-medium">Amendments</h4>
          <ul className="space-y-2 text-sm">
            {detail.amendments.map((row) => (
              <li key={String(row.id)}>
                {formatInvoiceDate(String(row.effective_date))}: GHS{" "}
                {Number(row.new_monthly_amount).toFixed(2)} — {String(row.change_reason)}
              </li>
            ))}
          </ul>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
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
              accept=".pdf,image/*"
              addLabel="Optional amendment document"
            />
            <button type="button" className={primaryBtn} onClick={submitAmendment}>
              Change amount
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h4 className="mb-3 font-medium">Generated APs</h4>
          <ul className="space-y-1 text-sm">
            {detail.payables.map((ap) => (
              <li key={String(ap.id)}>
                {String(ap.invoice_number)} — {String(ap.status)} — balance{" "}
                {formatInvoiceMoney(Number(ap.balance_due ?? ap.amount) || 0)}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h4 className="mb-3 font-medium">Record replacement payment</h4>
          <div className="grid gap-2 md:grid-cols-2">
            <input
              type="date"
              className={inputClassName}
              value={replacementForm.service_date}
              onChange={(e) =>
                setReplacementForm({ ...replacementForm, service_date: e.target.value })
              }
            />
            <input
              className={inputClassName}
              placeholder="Replacement name"
              value={replacementForm.replacement_name}
              onChange={(e) =>
                setReplacementForm({
                  ...replacementForm,
                  replacement_name: e.target.value,
                })
              }
            />
            <input
              type="number"
              className={inputClassName}
              placeholder="Amount"
              value={replacementForm.amount}
              onChange={(e) =>
                setReplacementForm({ ...replacementForm, amount: e.target.value })
              }
            />
          </div>
          <button type="button" className={`${primaryBtn} mt-3`} onClick={submitReplacement}>
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
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Link href="/dashboard/finance/supplier-contracts/new" className={primaryBtn}>
          New supplier contract
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-4 py-2">Contract</th>
              <th className="px-4 py-2">Supplier</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Next billing</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  <Link
                    href={`/dashboard/finance/supplier-contracts/${row.id}`}
                    className="font-medium text-[#0f2744] hover:underline"
                  >
                    {row.contract_number}
                  </Link>
                </td>
                <td className="px-4 py-2">{row.supplier_name}</td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${supplierContractStatusBadgeClassName(row.status)}`}
                  >
                    {formatSupplierContractStatus(row.status)}
                  </span>
                  {isSupplierContractRenewalDue(row.end_date) ? (
                    <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                      Renewal Due
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2">
                  {row.next_billing_date
                    ? formatInvoiceDate(row.next_billing_date)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
