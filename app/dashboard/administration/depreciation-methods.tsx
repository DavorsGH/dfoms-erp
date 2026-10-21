"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { getNamedLookupDeleteErrorMessage } from "@/utils/named-lookup-delete-errors";
import {
  assertTenantIdForMutation,
  tenantScopedDelete,
} from "@/utils/tenant-scoped-supabase";
import type { NamedLookup } from "../lookup-types";
import { useLookupSettingsFeedback } from "./lookup-settings-feedback";

type DepreciationMethodsProps = {
  tenantId: string;
  initialMethods: NamedLookup[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function DepreciationMethods({
  tenantId,
  initialMethods,
  fetchError,
}: DepreciationMethodsProps) {
  const supabase = createClient();
  const { showActionError, showActionSuccess } =
    useLookupSettingsFeedback(fetchError);
  const [methods, setMethods] = useState(initialMethods);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  async function refreshMethods() {
    const { data, error: refreshError } = await supabase
      .from("depreciation_methods")
      .select("name")
      .order("name", { ascending: true });

    if (refreshError) {
      showActionError(refreshError);
      return;
    }

    setMethods(data ?? []);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const scopedTenantId = assertTenantIdForMutation(tenantId);
    const { error: insertError } = await supabase
      .from("depreciation_methods")
      .insert({ tenant_id: scopedTenantId, name: name.trim() });

    if (insertError) {
      setLoading(false);
      showActionError(insertError);
      return;
    }

    setName("");
    await refreshMethods();
    setLoading(false);
    showActionSuccess("Depreciation method added.");
  }

  async function handleDelete(methodName: string) {
    setDeletingName(methodName);

    const { error: deleteError } = await tenantScopedDelete(
      supabase,
      "depreciation_methods",
      assertTenantIdForMutation(tenantId),
      { name: methodName },
    );

    if (deleteError) {
      setDeletingName(null);
      showActionError(
        getNamedLookupDeleteErrorMessage(deleteError, "depreciation method"),
      );
      return;
    }

    await refreshMethods();
    setDeletingName(null);
    showActionSuccess("Depreciation method deleted.");
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
        Depreciation Methods
      </h2>

      <form onSubmit={handleAdd} className="mb-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Method name"
          className={inputClassName}
        />
        <button
          type="submit"
          disabled={loading}
          className="shrink-0 rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Adding…" : "Add"}
        </button>
      </form>

      {methods.length === 0 ? (
        <p className="text-sm text-slate-500">No depreciation methods yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {methods.map((method) => (
            <li
              key={method.name}
              className="flex items-center justify-between px-4 py-3 text-sm text-slate-700"
            >
              <span>{method.name}</span>
              <button
                type="button"
                onClick={() => handleDelete(method.name)}
                disabled={deletingName === method.name}
                className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingName === method.name ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
