"use client";

import { useEffect, useState } from "react";

export type FinanceSupplierOption = { id: string; name: string };

export function useFinanceSuppliers() {
  const [suppliers, setSuppliers] = useState<FinanceSupplierOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/finance/suppliers")
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled) return;
        setSuppliers(
          ((payload.suppliers as FinanceSupplierOption[] | undefined) ?? []).map(
            (s) => ({ id: s.id, name: s.name }),
          ),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { suppliers, setSuppliers, loading };
}
