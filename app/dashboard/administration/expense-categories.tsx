"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { NamedLookup } from "../lookup-types";
import { useOfflineWriteBlocked } from "@/hooks/use-online-status";
import { invalidateReferenceLookupsAfterWrite } from "@/lib/client-cache/dashboard-summary-cache";
import { resolveClientCacheSession } from "@/lib/client-cache/session-context";

type ExpenseCategoriesProps = {
  initialCategories: NamedLookup[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function ExpenseCategories({
  initialCategories,
  fetchError,
}: ExpenseCategoriesProps) {
  const supabase = createClient();
  const { isOffline, offlineWriteMessage } = useOfflineWriteBlocked();
  const [categories, setCategories] = useState(initialCategories);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);

  async function invalidateReferenceCache() {
    const session = await resolveClientCacheSession();
    if (session) {
      await invalidateReferenceLookupsAfterWrite(session);
    }
  }

  async function refreshCategories() {
    const { data, error: refreshError } = await supabase
      .from("expense_categories")
      .select("name")
      .order("name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setCategories(data ?? []);
    setError(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (isOffline) {
      setError(offlineWriteMessage);
      return;
    }
    setLoading(true);
    setError(null);

    const { error: insertError } = await supabase
      .from("expense_categories")
      .insert({ name: name.trim() });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setName("");
    await refreshCategories();
    await invalidateReferenceCache();
    setLoading(false);
  }

  async function handleDelete(categoryName: string) {
    if (isOffline) {
      setError(offlineWriteMessage);
      return;
    }
    setDeletingName(categoryName);
    setError(null);

    const { error: deleteError } = await supabase
      .from("expense_categories")
      .delete()
      .eq("name", categoryName);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingName(null);
      return;
    }

    await refreshCategories();
    await invalidateReferenceCache();
    setDeletingName(null);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
        Expense Categories
      </h2>

      {isOffline && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {offlineWriteMessage}
        </p>
      )}

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
          placeholder="Category name"
          className={inputClassName}
        />
        <button
          type="submit"
          disabled={loading || isOffline}
          className="shrink-0 rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Adding…" : "Add"}
        </button>
      </form>

      {categories.length === 0 ? (
        <p className="text-sm text-slate-500">No expense categories yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {categories.map((category) => (
            <li
              key={category.name}
              className="flex items-center justify-between px-4 py-3 text-sm text-slate-700"
            >
              <span>{category.name}</span>
              <button
                type="button"
                onClick={() => handleDelete(category.name)}
                disabled={deletingName === category.name || isOffline}
                className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingName === category.name ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
