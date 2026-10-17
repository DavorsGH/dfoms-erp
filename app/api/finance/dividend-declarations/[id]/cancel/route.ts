import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireDividendsWrite } from "@/lib/finance/dividends-auth";
import { dividendRpcErrorMessage } from "@/lib/finance/dividends-server";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

type CancelBody = {
  tenant_id?: string;
  cancel_reason?: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireDividendsWrite();
  if (!auth.ok) {
    return auth.response;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CancelBody;
  try {
    body = (await request.json()) as CancelBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const reason = body.cancel_reason?.trim();
  if (!reason) {
    return NextResponse.json({ error: "Cancel reason is required." }, { status: 400 });
  }

  const { id } = await context.params;
  const admin = createAdminClient();

  const { error: rpcError } = await admin.rpc("cancel_dividend_atomic", {
    p_tenant_id: auth.tenantId,
    p_declaration_id: id,
    p_cancelled_by: user.id,
    p_reason: reason,
  });

  if (rpcError) {
    return NextResponse.json(
      { error: dividendRpcErrorMessage(rpcError) },
      { status: 400 },
    );
  }

  const { data: refreshed } = await admin
    .from("dividend_declarations")
    .select("*")
    .eq("id", id)
    .single();

  return NextResponse.json({ declaration: refreshed });
}
