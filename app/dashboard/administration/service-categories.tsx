"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { ServiceType } from "../service-types";

type ServiceCategoriesProps = {
  initialCategories: ServiceType[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function ServiceCategories({
  initialCategories,
  fetchError,
}: ServiceCategoriesProps) {
  const supabase = createClient();
  const [categories, setCategories] = useState(initialCategories);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);

  async function refreshCategories() {
    const { data, error: refreshError } = await supabase
      .from("service_types")
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
    setLoading(true);
    setError(null);

    const { error: insertError } = await supabase
      .from("service_types")
      .insert({ name: name.trim() });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setName("");
    await refreshCategories();
    setLoading(false);
  }

  async function handleDelete(categoryName: string) {
    setDeletingName(categoryName);
    setError(null);

    const { error: deleteError } = await supabase
      .from("service_types")
      .delete()
      .eq("name", categoryName);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingName(null);
      return;
    }

    await refreshCategories();
    setDeletingName(null);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
        Service Categories
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
          placeholder="Category name"
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

      {categories.length === 0 ? (
        <p className="text-sm text-slate-500">No service categories yet.</p>
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
                disabled={deletingName === category.name}
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
