"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { NamedLookup } from "../lookup-types";

type PaymentMethodsProps = {
  initialMethods: NamedLookup[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function PaymentMethods({
  initialMethods,
  fetchError,
}: PaymentMethodsProps) {
  const supabase = createClient();
  const [methods, setMethods] = useState(initialMethods);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);

  async function refreshMethods() {
    const { data, error: refreshError } = await supabase
      .from("payment_methods")
      .select("name")
      .order("name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setMethods(data ?? []);
    setError(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: insertError } = await supabase
      .from("payment_methods")
      .insert({ name: name.trim() });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setName("");
    await refreshMethods();
    setLoading(false);
  }

  async function handleDelete(methodName: string) {
    setDeletingName(methodName);
    setError(null);

    const { error: deleteError } = await supabase
      .from("payment_methods")
      .delete()
      .eq("name", methodName);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingName(null);
      return;
    }

    await refreshMethods();
    setDeletingName(null);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
        Payment Methods
      </h2>

      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={handleAdd} className="mb-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Payment method name"
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
        <p className="text-sm text-slate-500">No payment methods yet.</p>
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
