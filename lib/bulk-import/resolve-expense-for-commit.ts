import "server-only";

import type { Client } from "pg";
import { EXPENSE_RECEIPT_ENTITY_TYPE, normalizeOptionalReceiptNo } from "@/app/dashboard/finance/expense-register-utils";
import { normalizeTenantLookupKey } from "@/lib/bulk-import/tenant-name-lookup";

export type ExpenseNameResolverCache = Map<string, string>;
export type ExpenseApproverNameResolverCache = Map<string, string>;
export type ExpensePaymentMethodResolverCache = Map<string, string>;

async function generateNextCodeInTransaction(
  client: Client,
  tenantId: string,
  entityType: string,
): Promise<string> {
  const result = await client.query(
    `SELECT public.generate_next_code($1, $2, 4) AS code`,
    [tenantId, entityType],
  );

  const code = String(result.rows[0]?.code ?? "").trim();
  if (!code) {
    throw new Error(`generate_next_code returned an empty ${entityType} code.`);
  }

  return code;
}

export async function resolveExpenseReceiptNoForCommit(input: {
  client: Client;
  tenantId: string;
  suppliedReceiptNo: string | null | undefined;
}): Promise<string> {
  const explicit = normalizeOptionalReceiptNo(input.suppliedReceiptNo);
  if (explicit) {
    return explicit;
  }

  return generateNextCodeInTransaction(
    input.client,
    input.tenantId,
    EXPENSE_RECEIPT_ENTITY_TYPE,
  );
}

async function resolveTenantNamedLookupForCommit(input: {
  client: Client;
  tenantId: string;
  tableName: "expense_categories" | "expense_subcategories";
  suppliedName: string;
  cache: ExpenseNameResolverCache;
  entityLabel: string;
  fieldKey: string;
}): Promise<string> {
  const trimmed = input.suppliedName.trim();
  if (!trimmed) {
    throw new Error(`${input.fieldKey} is required.`);
  }

  const key = normalizeTenantLookupKey(trimmed);
  const cached = input.cache.get(key);
  if (cached) {
    return cached;
  }

  const existing = await input.client.query(
    `
      SELECT name
      FROM public.${input.tableName}
      WHERE tenant_id = $1
        AND lower(trim(name)) = $2
      ORDER BY name
    `,
    [input.tenantId, key],
  );

  if (existing.rows.length > 1) {
    throw new Error(
      `${input.fieldKey} "${trimmed}" matches multiple ${input.entityLabel} for this tenant`,
    );
  }

  if (existing.rows.length === 1) {
    const canonicalName = String(existing.rows[0].name);
    input.cache.set(key, canonicalName);
    return canonicalName;
  }

  const created = await input.client.query(
    `
      INSERT INTO public.${input.tableName} (tenant_id, name)
      VALUES ($1, $2)
      RETURNING name
    `,
    [input.tenantId, trimmed],
  );

  const canonicalName = String(created.rows[0].name);
  input.cache.set(key, canonicalName);
  return canonicalName;
}

export async function resolveExpenseCategoryForCommit(input: {
  client: Client;
  tenantId: string;
  categoryName: string;
  cache: ExpenseNameResolverCache;
}): Promise<string> {
  return resolveTenantNamedLookupForCommit({
    client: input.client,
    tenantId: input.tenantId,
    tableName: "expense_categories",
    suppliedName: input.categoryName,
    cache: input.cache,
    entityLabel: "expense categories",
    fieldKey: "expense_category",
  });
}

export async function resolveExpenseSubcategoryForCommit(input: {
  client: Client;
  tenantId: string;
  subcategoryName: string;
  cache: ExpenseNameResolverCache;
}): Promise<string> {
  return resolveTenantNamedLookupForCommit({
    client: input.client,
    tenantId: input.tenantId,
    tableName: "expense_subcategories",
    suppliedName: input.subcategoryName,
    cache: input.cache,
    entityLabel: "expense subcategories",
    fieldKey: "sub_category",
  });
}

export async function resolveExpensePaymentMethodForCommit(input: {
  client: Client;
  tenantId: string;
  paymentMethodName: string;
  cache: ExpensePaymentMethodResolverCache;
}): Promise<string> {
  const trimmed = input.paymentMethodName.trim();
  if (!trimmed) {
    throw new Error("payment_method is required.");
  }

  const key = normalizeTenantLookupKey(trimmed);
  const cached = input.cache.get(key);
  if (cached) {
    return cached;
  }

  const existing = await input.client.query(
    `
      SELECT name
      FROM public.payment_methods
      WHERE tenant_id = $1
        AND lower(trim(name)) = $2
      ORDER BY name
    `,
    [input.tenantId, key],
  );

  if (existing.rows.length > 1) {
    throw new Error(
      `payment_method "${trimmed}" matches multiple payment methods for this tenant`,
    );
  }

  if (existing.rows.length === 0) {
    throw new Error(`payment_method "${trimmed}" not found in payment methods`);
  }

  const canonicalName = String(existing.rows[0].name);
  input.cache.set(key, canonicalName);
  return canonicalName;
}

export async function resolveExpenseApproverNameForCommit(input: {
  client: Client;
  tenantId: string;
  approverName: string;
  cache: ExpenseApproverNameResolverCache;
}): Promise<string> {
  const trimmed = input.approverName.trim();
  if (!trimmed) {
    throw new Error("approved_by is required.");
  }

  const key = normalizeTenantLookupKey(trimmed);
  const cached = input.cache.get(key);
  if (cached) {
    return cached;
  }

  const existingApprover = await input.client.query(
    `
      SELECT e.full_name
      FROM public.approvers a
      INNER JOIN public.employees e
        ON e.employee_id = a.employee_id
       AND e.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1
        AND lower(trim(e.full_name)) = $2
      ORDER BY e.employee_id
    `,
    [input.tenantId, key],
  );

  if (existingApprover.rows.length > 1) {
    throw new Error(
      `approved_by "${trimmed}" matches multiple approvers for this tenant`,
    );
  }

  if (existingApprover.rows.length === 1) {
    const canonicalName = String(existingApprover.rows[0].full_name);
    input.cache.set(key, canonicalName);
    return canonicalName;
  }

  const employeeMatches = await input.client.query(
    `
      SELECT employee_id, full_name
      FROM public.employees
      WHERE tenant_id = $1
        AND lower(trim(full_name)) = $2
      ORDER BY employee_id
    `,
    [input.tenantId, key],
  );

  if (employeeMatches.rows.length > 1) {
    throw new Error(
      `approved_by "${trimmed}" matches multiple employees for this tenant`,
    );
  }

  if (employeeMatches.rows.length === 0) {
    // expense_register.approved_by is a free-text name column; approvers requires
    // employee_id NOT NULL (FK → employees), so we cannot create an approvers row
    // without a matching employee. Store the supplied name on the expense row only.
    input.cache.set(key, trimmed);
    return trimmed;
  }

  const employeeId = String(employeeMatches.rows[0].employee_id);

  await input.client.query(
    `
      INSERT INTO public.approvers (tenant_id, employee_id)
      VALUES ($1, $2)
      ON CONFLICT (tenant_id, employee_id) DO NOTHING
    `,
    [input.tenantId, employeeId],
  );

  const canonicalName = String(employeeMatches.rows[0].full_name);
  input.cache.set(key, canonicalName);
  return canonicalName;
}
