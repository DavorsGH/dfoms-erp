import { NextResponse } from "next/server";
import { isNonOtpSmsSendingEnabled } from "@/utils/sms-shared";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    VERCEL_URL: process.env.VERCEL_URL ?? null,
    SMS_PROVIDER: process.env.SMS_PROVIDER ?? null,
    NON_OTP_SMS_ENABLED: process.env["NON_OTP_SMS_ENABLED"] ?? null,
    isNonOtpSmsSendingEnabled: isNonOtpSmsSendingEnabled(),
  });
}
