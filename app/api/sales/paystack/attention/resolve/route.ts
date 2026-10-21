import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  PAYSTACK_ATTENTION_SALE_RETIRED,
  resolvePaystackAttention,
} from "@/utils/paystack-attention-resolve";
import { PAYSTACK_ATTENTION_RESOLVE_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

type ResolveBody = {
  id?: string;
  action?: string;
};

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(PAYSTACK_ATTENTION_RESOLVE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: ResolveBody;
  try {
    body = (await request.json()) as ResolveBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action = body.action;
  if (action === "sale") {
    return NextResponse.json(
      { error: PAYSTACK_ATTENTION_SALE_RETIRED },
      { status: 400 },
    );
  }
  if (!id || (action !== "store_credit" && action !== "refunded")) {
    return NextResponse.json(
      { error: "Choose a payment and a resolution." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await resolvePaystackAttention(createAdminClient(), {
      tenantId: auth.tenantId,
      attentionId: id,
      action,
      resolvedBy: user.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, message: result.message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve the payment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
