import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { CLIENT_RECEIPT_LIST_SELECT } from "@/utils/client-receipts-types";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export async function GET() {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("client_receipts")
    .select(CLIENT_RECEIPT_LIST_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("receipt_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ receipts: data ?? [] });
}
