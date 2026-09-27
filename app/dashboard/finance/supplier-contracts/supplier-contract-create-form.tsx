"use client";



import Link from "next/link";

import { useRouter } from "next/navigation";

import { useEffect, useState } from "react";

import ImageFileUploadButton from "@/components/image-file-upload-button";

import type { NamedLookup } from "@/app/dashboard/lookup-types";

import {

  useBusinessUnitView,

  useStampBusinessUnitId,

} from "@/app/dashboard/business-unit-view-context";

import { inputClassName } from "@/app/dashboard/employees/employee-record-utils";

import {
  SUPPLIER_CONTRACT_DOCUMENT_ACCEPT,
  SUPPLIER_CONTRACT_DOCUMENT_HINT,
} from "@/utils/supplier-contract-document";

import type { SupplierAgreementType } from "@/utils/supplier-contracts-types";

import { useFinanceSuppliers } from "./use-finance-suppliers";



const primaryBtn =

  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50";

const secondaryBtn =

  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50";



type Props = {

  expenseCategories: NamedLookup[];

  expenseSubcategories: NamedLookup[];

};



export default function SupplierContractCreateForm({

  expenseCategories,

  expenseSubcategories,

}: Props) {

  const router = useRouter();

  const { suppliers, setSuppliers } = useFinanceSuppliers();

  const { units } = useBusinessUnitView();

  const stampBusinessUnit = useStampBusinessUnitId();

  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const [newSupplierName, setNewSupplierName] = useState("");

  const [pendingDoc, setPendingDoc] = useState<File[]>([]);



  const [form, setForm] = useState({

    supplier_id: "",

    agreement_type: "verbal" as SupplierAgreementType,

    business_unit_id: "",

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



  useEffect(() => {

    if (units.length === 0) return;

    if (form.business_unit_id) return;

    if (stampBusinessUnit.ok && stampBusinessUnit.businessUnitId) {

      setForm((current) => ({

        ...current,

        business_unit_id: stampBusinessUnit.businessUnitId!,

      }));

    }

  }, [units.length, stampBusinessUnit, form.business_unit_id]);



  async function uploadDocument(

    contractId: string,

    file: File,

  ): Promise<string | null> {

    const fd = new FormData();

    fd.set("contract_id", contractId);

    fd.set("file", file);

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



  async function addSupplierInline() {

    const name = newSupplierName.trim();

    if (!name) return;

    const response = await fetch("/api/finance/suppliers", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ name }),

    });

    const payload = (await response.json()) as {

      supplier?: { id: string; name: string };

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



  async function handleCreate(e: React.FormEvent) {

    e.preventDefault();

    setSaving(true);

    setError(null);

    try {

      if (units.length > 0 && !form.business_unit_id.trim()) {

        throw new Error("Business unit is required.");

      }

      if (!stampBusinessUnit.ok && units.length > 0) {

        throw new Error(stampBusinessUnit.error);

      }

      if (form.agreement_type === "written" && pendingDoc.length === 0) {

        throw new Error("Written agreements require an uploaded document.");

      }

      const createAsDraft = form.agreement_type === "written";

      const createRes = await fetch("/api/supplier-contracts", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          ...form,

          status: createAsDraft ? "draft" : form.status,

          wht_rate: Number(form.wht_rate) || 0,

          initial_monthly_amount: Number(form.initial_monthly_amount),

          mid_month_reminder_day: Number(form.mid_month_reminder_day) || 15,

          business_unit_id: form.business_unit_id.trim() || null,

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

      }

      router.push(`/dashboard/finance/supplier-contracts/${created.contract.id}`);

      router.refresh();

    } catch (err) {

      setError(err instanceof Error ? err.message : "Create failed.");

    } finally {

      setSaving(false);

    }

  }



  return (

    <div className="space-y-4">

      {error ? (

        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">

          {error}

        </p>

      ) : null}

      <form onSubmit={handleCreate} className="space-y-4 rounded-lg border border-slate-200 p-4">

        <div className="grid gap-4 md:grid-cols-2">

          {units.length > 0 ? (

            <label className="block text-sm md:col-span-2">

              Business unit

              <select

                className={`${inputClassName} mt-1 w-full`}

                value={form.business_unit_id}

                onChange={(e) =>

                  setForm({ ...form, business_unit_id: e.target.value })

                }

                required

              >

                <option value="">Select business unit</option>

                {units.map((unit) => (

                  <option key={unit.id} value={unit.id}>

                    {unit.name}

                  </option>

                ))}

              </select>

            </label>

          ) : null}

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

              <span className="mb-1 block font-medium">Agreement document (required)</span>

              <ImageFileUploadButton

                files={pendingDoc}

                onChange={setPendingDoc}

                multiple={false}

                accept={SUPPLIER_CONTRACT_DOCUMENT_ACCEPT}

                emptyHint={SUPPLIER_CONTRACT_DOCUMENT_HINT}

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

