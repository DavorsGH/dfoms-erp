import { NextResponse } from "next/server";
import { generateSupplierContractAccountsPayable } from "@/utils/generate-supplier-contract-accounts-payable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[generate-supplier-contract-ap] CRON_SECRET is not configured");
    return false;
  }
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

async function handleCron(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const asOf = url.searchParams.get("asOf")?.trim() || undefined;
  const tenantId = url.searchParams.get("tenantId")?.trim() || undefined;

  try {
    const result = await generateSupplierContractAccountsPayable({ asOf, tenantId });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Supplier contract AP generation failed";
    console.error("[generate-supplier-contract-ap]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
