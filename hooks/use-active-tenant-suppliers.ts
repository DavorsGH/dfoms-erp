"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { fetchActiveTenantSuppliers } from "@/utils/tenant-suppliers-client";
import type { SupplierRow } from "@/utils/suppliers-types";
import { toVendorSupplierOptions } from "@/app/dashboard/finance/expense-register-form-fields";
import type { VendorSupplierOption } from "@/app/dashboard/finance/vendor-select-utils";

export function useActiveTenantSuppliers(options: { enabled: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const result = await fetchActiveTenantSuppliers(supabase);
      if (cancelled) {
        return;
      }
      setSuppliers(result.suppliers);
      setError(result.error);
      setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [options.enabled, supabase]);

  const vendorOptions: VendorSupplierOption[] = useMemo(
    () => toVendorSupplierOptions(suppliers),
    [suppliers],
  );

  return { suppliers, vendorOptions, loading, error };
}
