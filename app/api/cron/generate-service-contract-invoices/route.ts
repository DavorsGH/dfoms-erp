import { NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/system-event-log";
import { generateServiceContractInvoices } from "@/utils/generate-service-contract-invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[generate-service-contract-invoices] CRON_SECRET is not configured");
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
    const result = await generateServiceContractInvoices({ asOf, tenantId });
    const errorCount = result.errors;
    await logSystemEvent({
      eventType: "cron",
      eventName: "generate-service-contract-invoices",
      status: errorCount > 0 ? "warning" : "success",
      message: `created ${result.created}, skipped ${result.skipped}, errors ${errorCount}`,
      metadata: {
        asOfDate: result.asOfDate,
        created: result.created,
        skipped: result.skipped,
        errorCount,
        tenantId: tenantId ?? null,
      },
    });

    return NextResponse.json({
      success: true,
      asOfDate: result.asOfDate,
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Service contract invoice generation failed";
    console.error("[generate-service-contract-invoices] fatal", message);
    await logSystemEvent({
      eventType: "cron",
      eventName: "generate-service-contract-invoices",
      status: "failure",
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
