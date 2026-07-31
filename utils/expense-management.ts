import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import { fetchPropertiesForLandlord } from "@/utils/property-management";
import type {
  ExpenseListRow,
  ExpensePropertyOption,
} from "@/app/dashboard/real-estate/expenses-utils";

export type {
  ExpenseListRow,
  ExpensePropertyOption,
} from "@/app/dashboard/real-estate/expenses-utils";

type ExpenseRow = {
  tenant_id: string;
  expense_id: string;
  property_id: string;
  category: string;
  amount_ghs: number | string;
  expense_date: string;
  description: string | null;
  receipt_url: string | null;
};

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchExpensePropertyOptionsForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ properties: ExpensePropertyOption[]; fetchError: string | null }> {
  const landlord = await assertDavorsManagedLandlord(admin, tenantId);
  if (!landlord.ok) {
    return { properties: [], fetchError: landlord.error };
  }

  const { rows, fetchError } = await fetchPropertiesForLandlord(
    admin,
    landlord.tenantId,
  );
  if (fetchError) {
    return { properties: [], fetchError };
  }

  return {
    properties: rows.map((row) => ({
      propertyId: row.propertyId,
      name: row.name,
    })),
    fetchError: null,
  };
}

export async function fetchExpensesForProperty(
  admin: SupabaseClient,
  tenantId: string,
  propertyId: string,
): Promise<{ rows: ExpenseListRow[]; fetchError: string | null }> {
  const landlord = await assertDavorsManagedLandlord(admin, tenantId);
  if (!landlord.ok) {
    return { rows: [], fetchError: landlord.error };
  }

  const trimmedPropertyId = propertyId.trim();
  if (!trimmedPropertyId) {
    return { rows: [], fetchError: "property_id is required" };
  }

  const { data: property, error: propertyError } = await admin
    .from("properties")
    .select("property_id")
    .eq("tenant_id", landlord.tenantId)
    .eq("property_id", trimmedPropertyId)
    .maybeSingle();

  if (propertyError) {
    return { rows: [], fetchError: propertyError.message };
  }
  if (!property) {
    return { rows: [], fetchError: "Property not found." };
  }

  const { data, error } = await admin
    .from("property_expenses")
    .select(
      "tenant_id, expense_id, property_id, category, amount_ghs, expense_date, description, receipt_url",
    )
    .eq("tenant_id", landlord.tenantId)
    .eq("property_id", trimmedPropertyId)
    .order("expense_date", { ascending: false });

  if (error) {
    return { rows: [], fetchError: error.message };
  }

  const rows: ExpenseListRow[] = [];
  for (const row of (data as ExpenseRow[] | null) ?? []) {
    const category = typeof row.category === "string" ? row.category.trim() : "";
    if (!category) {
      continue;
    }
    rows.push({
      expenseId: row.expense_id,
      tenantId: row.tenant_id,
      propertyId: row.property_id,
      category,
      amountGhs: toNumber(row.amount_ghs),
      expenseDate: row.expense_date,
      description: row.description,
      receiptUrl: row.receipt_url,
    });
  }

  return { rows, fetchError: null };
}
