import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TraceEntry = {
  provider: "formula_dc" | "hubtel" | "other";
  url: string;
  requestBody: unknown;
  responseStatus: number;
  responseBody: unknown;
};

const traces: TraceEntry[] = [];
let hubtelCalls = 0;
let formulaDcCalls = 0;
let fetchPatched = false;

function ensureFetchCapture() {
  if (fetchPatched) return;
  fetchPatched = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    let provider: TraceEntry["provider"] = "other";
    if (url.includes("api.formula-dc.com")) {
      provider = "formula_dc";
      formulaDcCalls += 1;
    } else if (url.includes("sms.hubtel.com")) {
      provider = "hubtel";
      hubtelCalls += 1;
    }

    const response = await originalFetch(input, init);
    if (provider !== "other") {
      const clone = response.clone();
      const text = await clone.text().catch(() => "");
      let responseBody: unknown = text;
      try {
        responseBody = text ? JSON.parse(text) : null;
      } catch {
        // keep text
      }

      let requestBody: unknown = null;
      if (init?.body && typeof init.body === "string") {
        try {
          requestBody = JSON.parse(init.body);
        } catch {
          requestBody = init.body;
        }
      }

      traces.push({
        provider,
        url,
        requestBody,
        responseStatus: response.status,
        responseBody,
      });
    }

    return response;
  };
}

/**
 * Preview-only live Formula-DC SMS smoke test (OTP + transactional).
 * Auth: X-Debug-Secret must match CRON_SECRET.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const secret = request.headers.get("x-debug-secret")?.trim();
  if (!secret || secret !== (process.env.CRON_SECRET ?? "").trim()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  traces.length = 0;
  hubtelCalls = 0;
  formulaDcCalls = 0;
  ensureFetchCapture();

  const body = (await request.json().catch(() => ({}))) as { phone?: string };
  const rawPhone = (body.phone ?? "0244303171").trim();

  const { toFormulaDcRecipient } = await import("@/utils/formula-dc-sms");
  const { resolveSmsProvider } = await import("@/utils/sms-provider");
  const { isNonOtpSmsSendingEnabled } = await import("@/utils/sms-shared");
  const { sendHubtelSms } = await import("@/utils/hubtel-sms");

  const normalized = toFormulaDcRecipient(rawPhone);
  if (!normalized) {
    return NextResponse.json(
      { error: `Invalid Ghana phone for Formula-DC: ${rawPhone}` },
      { status: 400 },
    );
  }

  const otpCode = String(Math.floor(100000 + Math.random() * 900000));

  const otpResult = await sendHubtelSms({
    to: rawPhone,
    content: `Davors Formula-DC OTP staging test ${otpCode}. Expires in 5 minutes.`,
    purpose: "otp",
  });

  const txnResult = await sendHubtelSms({
    to: rawPhone,
    content: `Davors Formula-DC transactional staging test at ${new Date().toISOString()}`,
  });

  const otpTrace = traces.find((t) => t.provider === "formula_dc");
  const txnTrace = traces.filter((t) => t.provider === "formula_dc").at(-1);

  return NextResponse.json({
    env: {
      VERCEL_ENV: process.env.VERCEL_ENV ?? null,
      SMS_PROVIDER: process.env.SMS_PROVIDER ?? null,
      FORMULA_DC_SENDER_ID: process.env.FORMULA_DC_SENDER_ID ?? null,
      NON_OTP_SMS_ENABLED: process.env.NON_OTP_SMS_ENABLED ?? null,
      isNonOtpSmsSendingEnabled: isNonOtpSmsSendingEnabled(),
      resolvedProvider: resolveSmsProvider(),
    },
    phone: {
      raw: rawPhone,
      formulaDcRecipient: normalized,
    },
    otp: {
      sendSmsResult: otpResult,
      requestBody: otpTrace?.requestBody ?? null,
      responseStatus: otpTrace?.responseStatus ?? null,
      responseBody: otpTrace?.responseBody ?? null,
    },
    transactional: {
      sendSmsResult: txnResult,
      requestBody: txnTrace?.requestBody ?? null,
      responseStatus: txnTrace?.responseStatus ?? null,
      responseBody: txnTrace?.responseBody ?? null,
    },
    providerCalls: {
      formulaDc: formulaDcCalls,
      hubtel: hubtelCalls,
      traces,
    },
  });
}
