"use client";

import { useCallback, useEffect, useState } from "react";
import { useAlert, useConfirm, useToast } from "@/components/feedback/feedback-context";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";

type AttentionRow = {
  id: string;
  paystack_reference: string;
  amount: number;
  customer_label: string | null;
  client_id: string | null;
  reason: string;
  created_at: string;
};

type AttentionAction = "store_credit" | "refunded";

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Accra",
  }).format(date);
}

export default function PaystackAttentionList({
  canResolve,
}: {
  canResolve: boolean;
}) {
  const { alertError } = useAlert();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<AttentionRow[]>([]);
  const [hidden, setHidden] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/sales/paystack/attention");
      const payload = (await response.json().catch(() => null)) as {
        rows?: AttentionRow[];
        unavailable?: boolean;
        error?: string;
      } | null;
      if (payload?.unavailable) {
        setRows([]);
        setHidden(true);
        return;
      }
      if (!response.ok || !payload) {
        setRows([]);
        setHidden(true);
        await alertError(payload?.error || "Could not load payments needing attention.", {
          title: "Paystack payment needs attention",
        });
        return;
      }
      const next = payload.rows ?? [];
      setRows(next);
      setHidden(next.length === 0);
    } catch {
      setRows([]);
      setHidden(true);
      await alertError("Couldn't reach the server. Check your connection and try again.", {
        title: "Paystack payment needs attention",
      });
    }
  }, [alertError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(row: AttentionRow, action: AttentionAction) {
    if (action === "refunded") {
      const accepted = await confirm({
        title: "Mark refunded",
        message:
          "Mark this payment refunded only after the refund is done in Paystack. This does not send a refund.",
        confirmLabel: "Mark refunded",
        destructive: true,
      });
      if (!accepted) {
        return;
      }
    }

    setBusyId(row.id);
    try {
      const response = await fetch("/api/sales/paystack/attention/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, action }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        setBusyId(null);
        await alertError(payload?.error || "Could not resolve the payment.", {
          title: "Paystack payment needs attention",
        });
        return;
      }
      toast(payload?.message || "Payment resolved");
      setBusyId(null);
      await load();
    } catch {
      setBusyId(null);
      await alertError("Couldn't reach the server. Check your connection and try again.", {
        title: "Paystack payment needs attention",
      });
    }
  }

  if (hidden) {
    return null;
  }

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold text-amber-950">Payments needing attention</h2>
      <p className="mt-1 text-sm text-amber-900">
        Paystack confirmed these payments and the sale was not recorded.
      </p>
      <ul className="mt-3 space-y-3">
        {rows.map((row) => {
          const customer = row.customer_label?.trim() || row.client_id?.trim() || "Customer";
          const busy = busyId === row.id;
          return (
            <li
              key={row.id}
              className="rounded-md border border-amber-200 bg-white px-3 py-3 text-sm text-slate-800"
            >
              <p className="font-medium text-[#0f2744]">
                {customer} · {formatGHS(Number(row.amount) || 0)} · ref {row.paystack_reference}
              </p>
              <p className="mt-1 text-slate-600">
                {formatWhen(row.created_at)} · {row.reason}
              </p>
              {canResolve ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm font-medium text-[#0f2744] disabled:opacity-60"
                    onClick={() => void resolve(row, "store_credit")}
                  >
                    Record as customer credit (store credit)
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm font-medium text-[#0f2744] disabled:opacity-60"
                    onClick={() => void resolve(row, "refunded")}
                  >
                    Mark refunded (refund done in Paystack)
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-slate-500">
                  A director, finance admin, or super admin resolves this payment.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
