import type { SupabaseClient } from "@supabase/supabase-js";

const EXPENSE_CATEGORY_USAGE_LABELS: Record<string, string> = {
  expense_register: "expense records",
  budgets: "budget lines",
  accounts_payable: "accounts payable records",
  supplier_contracts: "supplier contracts",
};

const EXPENSE_SUBCATEGORY_USAGE_LABELS: Record<string, string> = {
  expense_register: "expense records",
  budgets: "budget lines",
  accounts_payable: "accounts payable records",
  supplier_contracts: "supplier contracts",
};

const ASSET_CATEGORY_USAGE_LABELS: Record<string, string> = {
  fixed_assets: "fixed asset records",
};

function usageLinesFromCounts(
  raw: Record<string, number> | null | undefined,
  labels: Record<string, string>,
): Array<{ label: string; count: number }> {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const lines: Array<{ label: string; count: number }> = [];
  for (const [key, label] of Object.entries(labels)) {
    const count = Number(raw[key] ?? 0);
    if (count > 0) {
      lines.push({ label, count });
    }
  }
  return lines;
}

function formatUsageFragment(lines: Array<{ label: string; count: number }>): string {
  return lines
    .map((line) => `${line.count} ${line.label}`)
    .join(" and ");
}

export function formatExpenseCategoryDeleteBlockedMessage(
  name: string,
  lines: Array<{ label: string; count: number }>,
  linkedSubcategoryCount: number,
): string {
  const parts: string[] = [];
  if (lines.length > 0) {
    parts.push(
      `Can't delete '${name}': it's used on ${formatUsageFragment(lines)}. Move those records to another category first, or use 'Hide from new entries' instead.`,
    );
  }
  if (linkedSubcategoryCount > 0) {
    parts.push(
      `Can't delete '${name}': it still has ${linkedSubcategoryCount} sub-categories. Delete or move them first.`,
    );
  }
  return parts.join(" ");
}

export function formatExpenseSubcategoryDeleteBlockedMessage(
  name: string,
  lines: Array<{ label: string; count: number }>,
): string {
  if (lines.length === 0) {
    return "";
  }
  return `Can't delete '${name}': it's used on ${formatUsageFragment(lines)}. Move those records to another sub-category first, or use 'Hide from new entries' instead.`;
}

export function formatAssetCategoryDeleteBlockedMessage(
  name: string,
  lines: Array<{ label: string; count: number }>,
): string {
  if (lines.length === 0) {
    return "";
  }
  return `Can't delete '${name}': it's used on ${formatUsageFragment(lines)}. Move those records to another category first, or use 'Hide from new entries' instead.`;
}

export async function fetchExpenseCategoryDeleteUsage(
  supabase: SupabaseClient,
  categoryName: string,
): Promise<{
  usageLines: Array<{ label: string; count: number }>;
  linkedSubcategoryCount: number;
}> {
  const { data, error } = await supabase.rpc("lookup_usage_expense_category", {
    p_name: categoryName.trim(),
  });
  if (error) {
    throw new Error(error.message);
  }
  const raw = (data ?? {}) as Record<string, number>;
  const linkedSubcategoryCount = Number(raw.linked_subcategories ?? 0);
  const usageLines = usageLinesFromCounts(raw, EXPENSE_CATEGORY_USAGE_LABELS);
  return { usageLines, linkedSubcategoryCount };
}

export async function fetchExpenseSubcategoryDeleteUsage(
  supabase: SupabaseClient,
  categoryName: string | null,
  subName: string,
): Promise<Array<{ label: string; count: number }>> {
  const { data, error } = await supabase.rpc("lookup_usage_expense_subcategory", {
    p_category: (categoryName ?? "").trim(),
    p_sub_name: subName.trim(),
  });
  if (error) {
    throw new Error(error.message);
  }
  return usageLinesFromCounts(
    (data ?? {}) as Record<string, number>,
    EXPENSE_SUBCATEGORY_USAGE_LABELS,
  );
}

export async function fetchAssetCategoryDeleteUsage(
  supabase: SupabaseClient,
  categoryName: string,
): Promise<Array<{ label: string; count: number }>> {
  const { data, error } = await supabase.rpc("lookup_usage_asset_category", {
    p_name: categoryName.trim(),
  });
  if (error) {
    throw new Error(error.message);
  }
  return usageLinesFromCounts(
    (data ?? {}) as Record<string, number>,
    ASSET_CATEGORY_USAGE_LABELS,
  );
}
