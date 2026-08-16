import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { ReferenceLookupsPayload } from "@/lib/client-cache/types";
import {
  getCurrentAuthUid,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const tenantId = await getCurrentUserTenantId();
  const authUid = await getCurrentAuthUid();

  if (!tenantId || !authUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    departmentsResult,
    positionsResult,
    projectsResult,
    shiftsResult,
    expenseCategoriesResult,
    paymentMethodsResult,
    leaveTypesResult,
    serviceTypesResult,
  ] = await Promise.all([
    supabase
      .from("departments")
      .select("dept_code, department_name")
      .eq("tenant_id", tenantId)
      .order("department_name", { ascending: true }),
    supabase
      .from("positions")
      .select("position_title")
      .eq("tenant_id", tenantId)
      .order("position_title", { ascending: true }),
    supabase
      .from("projects")
      .select("project_code, project_name")
      .eq("tenant_id", tenantId)
      .order("project_name", { ascending: true }),
    supabase.from("shifts").select("name").order("name", { ascending: true }),
    supabase
      .from("expense_categories")
      .select("name")
      .order("name", { ascending: true }),
    supabase
      .from("payment_methods")
      .select("name")
      .order("name", { ascending: true }),
    supabase.from("leave_types").select("type_name").order("type_name"),
    supabase.from("service_types").select("name").order("name", { ascending: true }),
  ]);

  const payload: ReferenceLookupsPayload = {
    departments: (departmentsResult.data ?? []).map((row) => ({
      code: String(row.dept_code),
      name: String(row.department_name),
    })),
    positions: (positionsResult.data ?? [])
      .map((row) => String(row.position_title ?? "").trim())
      .filter(Boolean)
      .map((title) => ({ id: title, name: title })),
    projects: (projectsResult.data ?? []).map((row) => ({
      code: String(row.project_code),
      name: String(row.project_name),
    })),
    shifts: (shiftsResult.data ?? []).map((row) => ({ name: String(row.name) })),
    expenseCategories: (expenseCategoriesResult.data ?? []).map((row) => ({
      name: String(row.name),
    })),
    paymentMethods: (paymentMethodsResult.data ?? []).map((row) => ({
      name: String(row.name),
    })),
    leaveTypes: (leaveTypesResult.data ?? []).map((row) => ({
      type_name: String(row.type_name),
    })),
    serviceTypes: (serviceTypesResult.data ?? []).map((row) => ({
      name: String(row.name),
    })),
  };

  return NextResponse.json({
    tenantId,
    authUid,
    cachedAt: new Date().toISOString(),
    payload,
  });
}
