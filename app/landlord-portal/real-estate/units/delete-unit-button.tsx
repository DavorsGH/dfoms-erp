"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  unitId: string;
  unitLabel: string;
};

export default function DeleteUnitButton({ unitId, unitLabel }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (
      !window.confirm(
        `Delete unit ${unitLabel}? This cannot be undone. Units with leases, rent history, applications, or an active tenant cannot be deleted.`,
      )
    ) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/landlord-portal/properties/units/delete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unit_id: unitId }),
        },
      );

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        can_delete?: boolean;
      } | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to delete unit.");
        return;
      }

      router.refresh();
    } catch {
      setError("Unable to delete unit. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={loading}
        onClick={() => void handleDelete()}
        className="text-sm font-medium text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Deleting…" : "Delete"}
      </button>
      {error ? (
        <p className="max-w-[14rem] text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
