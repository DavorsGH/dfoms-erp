"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

export type PositionRow = {
  position_title: string;
};

type PositionsProps = {
  initialPositions: PositionRow[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function Positions({
  initialPositions,
  fetchError,
}: PositionsProps) {
  const supabase = createClient();
  const [positions, setPositions] = useState(initialPositions);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingTitle, setDeletingTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);

  async function refreshPositions() {
    const { data, error: refreshError } = await supabase
      .from("positions")
      .select("position_title")
      .order("position_title", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setPositions((data as PositionRow[] | null) ?? []);
    setError(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const positionTitle = title.trim();
    if (!positionTitle) {
      setError("Position title is required.");
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase
      .from("positions")
      .insert({ position_title: positionTitle });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setTitle("");
    await refreshPositions();
    setLoading(false);
  }

  async function handleDelete(positionTitle: string) {
    setDeletingTitle(positionTitle);
    setError(null);

    const { error: deleteError } = await supabase
      .from("positions")
      .delete()
      .eq("position_title", positionTitle);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingTitle(null);
      return;
    }

    await refreshPositions();
    setDeletingTitle(null);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
        Manage Positions
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
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Position title"
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

      {positions.length === 0 ? (
        <p className="text-sm text-slate-500">No positions yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {positions.map((position) => (
            <li
              key={position.position_title}
              className="flex items-center justify-between px-4 py-3 text-sm text-slate-700"
            >
              <span>{position.position_title}</span>
              <button
                type="button"
                onClick={() => handleDelete(position.position_title)}
                disabled={deletingTitle === position.position_title}
                className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingTitle === position.position_title
                  ? "Deleting…"
                  : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
