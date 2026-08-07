import { NextResponse } from "next/server";
import { runSmsResendPolicySelfTest } from "@/lib/mfa/sms-resend-rate-limit-self-test";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Staging verification for SMS resend policy (Upstash-backed).
 * curl -H "Authorization: Bearer $CRON_SECRET" https://<preview>/api/cron/mfa-sms-resend-policy-check
 */
export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSmsResendPolicySelfTest();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Self-test failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
