import { NextResponse } from "next/server";
import { requireDividendsWrite } from "@/lib/finance/dividends-auth";
import { dividendRpcClientErrorMessage } from "@/lib/finance/directors-board-api-errors";
import { fetchDividendDeclarationWriteBundle } from "@/lib/finance/dividends-load";
import { createAdminClient } from "@/utils/supabase/admin";
import type { ShareholderPaymentMethod } from "@/app/dashboard/finance/dividends-types";

type PayBody = {
  tenant_id?: string;
  payment_date?: string;
  payment_method?: ShareholderPaymentMethod;
  payment_reference?: string | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireDividendsWrite();
  if (!auth.ok) {
    return auth.response;
  }

  let body: PayBody;
  try {
    body = (await request.json()) as PayBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const paymentDate = body.payment_date?.slice(0, 10);
  if (!paymentDate) {
    return NextResponse.json({ error: "Payment date is required." }, { status: 400 });
  }

  const paymentMethod = body.payment_method;
  if (!paymentMethod) {
    return NextResponse.json({ error: "Payment method is required." }, { status: 400 });
  }

  const { id: lineId } = await context.params;
  const admin = createAdminClient();

  const { data: declarationStatus, error: rpcError } = await admin.rpc(
    "pay_dividend_line_atomic",
    {
      p_tenant_id: auth.tenantId,
      p_line_id: lineId,
      p_payment_date: paymentDate,
      p_payment_method: paymentMethod,
      p_payment_reference: body.payment_reference?.trim() || "",
    },
  );

  if (rpcError) {
    return NextResponse.json(
      { error: dividendRpcClientErrorMessage(rpcError) },
      { status: 400 },
    );
  }

  const { data: updatedLine } = await admin
    .from("dividend_declaration_lines")
    .select("*")
    .eq("tenant_id", auth.tenantId)
    .eq("id", lineId)
    .maybeSingle();

  const declarationFullyPaid = declarationStatus === "paid";
  const declarationId = updatedLine?.declaration_id;
  const bundle =
    typeof declarationId === "string" && declarationId
      ? await fetchDividendDeclarationWriteBundle(
          admin,
          auth.tenantId,
          declarationId,
        )
      : { declaration: null, lines: [] };

  return NextResponse.json({
    declaration: bundle.declaration,
    lines: bundle.lines,
    line: updatedLine,
    declarationFullyPaid,
    declarationStatus,
  });
}
