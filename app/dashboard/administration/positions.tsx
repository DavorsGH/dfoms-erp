"use client";

import { useEffect, useState } from "react";
import { useAlert, useToast } from "@/components/feedback";
import { createClient } from "@/utils/supabase/client";
import {
  formatPositionAddFailedMessage,
  formatPositionDeleteFailedMessage,
  formatPositionDuplicateTitleMessage,
  resolvePositionDeleteClientMessage,
} from "@/utils/position-delete-errors";
import { formatCantDeleteAlertTitle } from "@/utils/delete-blocked-messaging";
import { assertTenantIdForMutation } from "@/utils/tenant-scoped-supabase";

export type PositionRow = {
  position_title: string;
};

type PositionsProps = {
  tenantId: string;
  initialPositions: PositionRow[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const POSITIONS_API = "/api/administration/positions";
const CANT_DELETE_POSITION_ALERT = {
  title: formatCantDeleteAlertTitle("position"),
};

async function readPositionsApiError(
  response: Response,
): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    const message = payload.error;
    return typeof message === "string" ? message : undefined;
  } catch {
    return undefined;
  }
}

export default function Positions({
  tenantId,
  initialPositions,
  fetchError,
}: PositionsProps) {
  const supabase = createClient();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const [positions, setPositions] = useState(initialPositions);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingTitle, setDeletingTitle] = useState<string | null>(null);

  useEffect(() => {
    if (fetchError) {
      alertError(fetchError);
    }
  }, [alertError, fetchError]);

  async function refreshPositions() {
    const scopedTenantId = assertTenantIdForMutation(tenantId);
    const { data, error: refreshError } = await supabase
      .from("positions")
      .select("position_title")
      .eq("tenant_id", scopedTenantId)
      .order("position_title", { ascending: true });

    if (refreshError) {
      console.error("[positions refresh]", refreshError);
      alertError("Couldn't refresh the positions list. Please try again.");
      return;
    }

    setPositions((data as PositionRow[] | null) ?? []);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const positionTitle = title.trim();
    if (!positionTitle) {
      alertError("Position title is required.");
      setLoading(false);
      return;
    }

    try {
      assertTenantIdForMutation(tenantId);
    } catch (tenantError) {
      alertError(
        tenantError instanceof Error
          ? tenantError.message
          : "Unable to resolve your workspace.",
      );
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(POSITIONS_API, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_title: positionTitle }),
      });

      if (!response.ok) {
        const apiError = await readPositionsApiError(response);
        const lower = (apiError ?? "").toLowerCase();
        if (
          lower.includes("already exists") ||
          lower.includes("duplicate")
        ) {
          alertError(formatPositionDuplicateTitleMessage(positionTitle));
        } else if (apiError) {
          alertError(apiError);
        } else {
          alertError(formatPositionAddFailedMessage(positionTitle));
        }
        setLoading(false);
        return;
      }

      setTitle("");
      await refreshPositions();
      toast("Position added.");
    } catch (addError) {
      console.error("[positions add]", addError);
      alertError(formatPositionAddFailedMessage(positionTitle));
    }

    setLoading(false);
  }

  async function handleDelete(positionTitle: string) {
    setDeletingTitle(positionTitle);

    try {
      assertTenantIdForMutation(tenantId);
    } catch (tenantError) {
      alertError(
        tenantError instanceof Error
          ? tenantError.message
          : "Unable to resolve your workspace.",
      );
      setDeletingTitle(null);
      return;
    }

    try {
      const response = await fetch(POSITIONS_API, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_title: positionTitle }),
      });

      if (!response.ok) {
        const apiError = await readPositionsApiError(response);
        alertError(
          resolvePositionDeleteClientMessage(positionTitle, apiError),
          CANT_DELETE_POSITION_ALERT,
        );
        setDeletingTitle(null);
        return;
      }

      await refreshPositions();
      toast("Position deleted.");
      setDeletingTitle(null);
    } catch (deleteError) {
      console.error("[positions delete]", deleteError);
      alertError(
        formatPositionDeleteFailedMessage(positionTitle),
        CANT_DELETE_POSITION_ALERT,
      );
      setDeletingTitle(null);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
        Manage Positions
      </h2>

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
