"use client";



import { useEffect, useMemo, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/utils/supabase/client";

import { mapApproverRows } from "../approver-utils";

import type { Approver, NamedLookup } from "../lookup-types";

import { resolveSessionTenantId } from "@/utils/session-tenant-client";

import type { SupplierRow } from "@/utils/suppliers-types";

import { SUPPLIER_SELECT } from "@/utils/suppliers-types";

import {

  normalizeExpenseSubcategoryLookup,

  queryExpenseSubcategoryLookups,

  type ExpenseSubcategoryLookup,

} from "./expense-register-utils";



export type ExpenseRegisterCreateLookups = {

  expenseCategories: Array<NamedLookup & { is_active?: boolean }>;

  expenseSubcategories: ExpenseSubcategoryLookup[];

  paymentMethods: NamedLookup[];

  approvers: Approver[];

  suppliers: SupplierRow[];

  loading: boolean;

  error: string | null;

};



export async function fetchExpenseRegisterCreateLookups(

  client: SupabaseClient,

): Promise<

  | { ok: true; lookups: Omit<ExpenseRegisterCreateLookups, "loading" | "error"> }

  | { ok: false; error: string }

> {

  const { tenantId } = await resolveSessionTenantId(client);



  const supplierQuery = tenantId

    ? client

        .from("suppliers")

        .select(SUPPLIER_SELECT)

        .eq("tenant_id", tenantId)

        .eq("is_active", true)

        .order("name", { ascending: true })

    : Promise.resolve({ data: [], error: null });



  const [

    { data: categories, error: categoriesError },

    { data: subcategories, error: subcategoriesError },

    { data: methods, error: methodsError },

    { data: approverRows, error: approversError },

    { data: supplierRows, error: suppliersError },

  ] = await Promise.all([

    client

      .from("expense_categories")

      .select("name, is_active")

      .order("name", { ascending: true }),

    queryExpenseSubcategoryLookups(client),

    client.from("payment_methods").select("name").order("name", { ascending: true }),

    client

      .from("approvers")

      .select("employee_id, employees!approvers_employee_id_fkey(full_name)")

      .order("employee_id", { ascending: true }),

    supplierQuery,

  ]);



  const lookupError =

    categoriesError?.message ??

    subcategoriesError?.message ??

    methodsError?.message ??

    approversError?.message ??

    suppliersError?.message ??

    null;



  if (lookupError) {

    return { ok: false, error: lookupError };

  }



  return {

    ok: true,

    lookups: {

      expenseCategories: (
        (categories as Array<{ name: string; is_active?: boolean }> | null) ?? []
      ).map((row) => ({
        name: row.name,
        is_active: row.is_active ?? true,
      })),

      expenseSubcategories: ((subcategories as ExpenseSubcategoryLookup[] | null) ?? []).map(

        normalizeExpenseSubcategoryLookup,

      ),

      paymentMethods: (methods as NamedLookup[] | null) ?? [],

      approvers: mapApproverRows(approverRows ?? []) as Approver[],

      suppliers: (supplierRows as SupplierRow[] | null) ?? [],

    },

  };

}



export function useExpenseRegisterCreateLookups(options: {

  enabled: boolean;

}): ExpenseRegisterCreateLookups {

  const supabase = useMemo(() => createClient(), []);

  const [expenseCategories, setExpenseCategories] = useState<
    Array<NamedLookup & { is_active?: boolean }>
  >([]);

  const [expenseSubcategories, setExpenseSubcategories] = useState<

    ExpenseSubcategoryLookup[]

  >([]);

  const [paymentMethods, setPaymentMethods] = useState<NamedLookup[]>([]);

  const [approvers, setApprovers] = useState<Approver[]>([]);

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



      const result = await fetchExpenseRegisterCreateLookups(supabase);



      if (cancelled) {

        return;

      }



      if (!result.ok) {

        setError(result.error);

        setLoading(false);

        return;

      }



      setExpenseCategories(result.lookups.expenseCategories);

      setExpenseSubcategories(result.lookups.expenseSubcategories);

      setPaymentMethods(result.lookups.paymentMethods);

      setApprovers(result.lookups.approvers);

      setSuppliers(result.lookups.suppliers);

      setLoading(false);

    }



    void load();



    return () => {

      cancelled = true;

    };

  }, [options.enabled, supabase]);



  return {

    expenseCategories,

    expenseSubcategories,

    paymentMethods,

    approvers,

    suppliers,

    loading,

    error,

  };

}

