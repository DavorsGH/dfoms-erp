import "server-only";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { FINANCE_ADMIN_EMPLOYEE_BULK_IMPORT_MESSAGE } from "@/lib/bulk-import/finance-admin-employee-import-messages";

export { FINANCE_ADMIN_EMPLOYEE_BULK_IMPORT_MESSAGE };

export async function rejectFinanceAdminEmployeeBulkImportResponse(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const admin = createAdminClient();
  const { data: account } = await admin
    .from("user_accounts")
    .select("role")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (account?.role !== "finance_admin") {
    return null;
  }

  return NextResponse.json(
    { error: FINANCE_ADMIN_EMPLOYEE_BULK_IMPORT_MESSAGE },
    { status: 403 },
  );
}
