"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import SmsResendCooldownNotice from "@/components/mfa/sms-resend-cooldown-notice";
import {
  formatMfaActionError,
  isSmsResendRateLimited,
} from "@/lib/mfa/format-sms-resend-wait";
import type { MfaActionResult, MfaPersona } from "@/lib/mfa/types";
import { useSmsResendCooldown } from "@/lib/mfa/use-sms-resend-cooldown";

type Settings = {
  method: string;
  smsPhoneE164: string | null;
  totpEnrolledAt: string | null;
  profilePhoneE164: string | null;
  profilePhoneSource: string | null;
  staffSmsEnrollmentPhoneLocked?: boolean;
  email: string;
} | null;

type Props = {
  persona: MfaPersona;
  initialSettings: Settings;
  onStartTotp: () => Promise<
    | { ok: true; factorId: string; qrCode: string; secret: string }
    | { ok: false; error: string }
  >;
  onConfirmTotp: (
    factorId: string,
    code: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onSendSmsOtp: (phoneOverride?: string) => Promise<MfaActionResult>;
  onConfirmSms: (
    code: string,
    phoneOverride?: string,
  ) => Promise<MfaActionResult>;
  onDisable: (code: string) => Promise<MfaActionResult>;
  onSendDisableSmsOtp: () => Promise<MfaActionResult>;
};

function smsProfilePhoneDescription(
  persona: MfaPersona,
  profilePhone: string,
): string {
  switch (persona) {
    case "staff":
      return `Codes are sent via Hubtel to your employee profile phone (${profilePhone}).`;
    case "lessee":
      return `Codes are sent via Hubtel to your tenant profile phone (${profilePhone}).`;
    case "landlord":
      return `Codes are sent via Hubtel to your notification phone (${profilePhone}).`;
    default:
      return `Codes are sent via Hubtel to your profile phone (${profilePhone}).`;
  }
}

function smsManualEntryIntro(persona: MfaPersona): string {
  switch (persona) {
    case "staff":
      return "No employee directory phone is linked to your account. Enter a mobile number below to receive a verification code via Hubtel.";
    case "lessee":
      return "Add a phone number to your tenant record, or enter one below to use SMS.";
    case "landlord":
      return "Set a notification phone in Workspace Settings, or enter one below to use SMS.";
    default:
      return "Enter a mobile number below to receive a verification code via Hubtel.";
  }
}

export default function MfaSettingsPanel({
  persona,
  initialSettings,
  onStartTotp,
  onConfirmTotp,
  onSendSmsOtp,
  onConfirmSms,
  onDisable,
  onSendDisableSmsOtp,
}: Props) {
  const router = useRouter();
  const [method, setMethod] = useState(initialSettings?.method ?? "none");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [totpFactorId, setTotpFactorId] = useState<string | null>(null);
  const [totpQr, setTotpQr] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");

  const [smsCode, setSmsCode] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [resendCooldownUntilMs, setResendCooldownUntilMs] = useState<
    number | null
  >(null);

  const clearResendCooldown = useCallback(() => {
    setResendCooldownUntilMs(null);
  }, []);

  const { remainingSeconds, isActive: isResendCooldownActive } =
    useSmsResendCooldown(resendCooldownUntilMs, clearResendCooldown);

  function applySmsSendResult(result: MfaActionResult): boolean {
    if (result.ok) {
      setResendCooldownUntilMs(null);
      return true;
    }

    if (isSmsResendRateLimited(result)) {
      setResendCooldownUntilMs(result.resendAvailableAtMs);
      setError(null);
      return false;
    }

    setResendCooldownUntilMs(null);
    setError(formatMfaActionError(result));
    return false;
  }

  const profilePhone = initialSettings?.profilePhoneE164 ?? null;
  const manualPhoneEntryAllowed = !profilePhone;
  const canSendSmsEnrollment =
    Boolean(profilePhone) ||
    (manualPhoneEntryAllowed && manualPhone.trim().length > 0);

  function resolveSmsPhoneOverride(): string | undefined {
    if (!manualPhoneEntryAllowed) return undefined;
    const trimmed = manualPhone.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  async function handleStartTotp() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    const result = await onStartTotp();
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setTotpFactorId(result.factorId);
    setTotpQr(result.qrCode);
    setTotpSecret(result.secret);
    setLoading(false);
  }

  async function handleConfirmTotp(e: React.FormEvent) {
    e.preventDefault();
    if (!totpFactorId) return;
    setLoading(true);
    setError(null);
    const result = await onConfirmTotp(totpFactorId, totpCode);
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setMethod("totp");
    setTotpFactorId(null);
    setTotpQr(null);
    setTotpSecret(null);
    setTotpCode("");
    setSuccess("Authenticator app two-factor is now enabled.");
    setLoading(false);
    router.refresh();
  }

  async function handleSendSms() {
    setLoading(true);
    setError(null);
    const result = await onSendSmsOtp(resolveSmsPhoneOverride());
    if (!applySmsSendResult(result)) {
      setLoading(false);
      return;
    }
    setSuccess("Verification code sent by SMS.");
    setLoading(false);
  }

  async function handleConfirmSms(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await onConfirmSms(smsCode, resolveSmsPhoneOverride());
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setMethod("sms");
    setSmsCode("");
    setSuccess("SMS two-factor is now enabled.");
    setLoading(false);
    router.refresh();
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await onDisable(disableCode);
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setMethod("none");
    setDisableCode("");
    setSuccess("Two-factor authentication has been disabled.");
    setLoading(false);
    router.refresh();
  }

  const cardClass =
    "rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4";

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {isResendCooldownActive && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3">
          <SmsResendCooldownNotice
            remainingSeconds={remainingSeconds}
            className="text-sm text-red-700"
          />
        </p>
      )}
      {success && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      )}

      <section className={cardClass}>
        <h2 className="text-lg font-semibold text-[#0f2744]">Current status</h2>
        <p className="text-sm text-slate-600">
          {method === "none" && "Two-factor authentication is off."}
          {method === "totp" && "Authenticator app is enabled for sign-in."}
          {method === "sms" &&
            `SMS is enabled${initialSettings?.smsPhoneE164 ? ` (${initialSettings.smsPhoneE164})` : ""}.`}
        </p>
      </section>

      {method === "none" && !totpQr && (
        <section className={cardClass}>
          <h2 className="text-lg font-semibold text-[#0f2744]">
            Enable authenticator app
          </h2>
          <p className="text-sm text-slate-600">
            Use Google Authenticator, Authy, or a similar TOTP app.
          </p>
          <button
            type="button"
            onClick={handleStartTotp}
            disabled={loading}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
          >
            Set up authenticator app
          </button>
        </section>
      )}

      {totpQr && (
        <section className={cardClass}>
          <h2 className="text-lg font-semibold text-[#0f2744]">
            Scan QR code
          </h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={totpQr} alt="TOTP QR code" className="mx-auto h-48 w-48" />
          {totpSecret && (
            <p className="break-all text-center text-xs text-slate-500">
              Manual key: {totpSecret}
            </p>
          )}
          <form onSubmit={handleConfirmTotp} className="space-y-3">
            <input
              inputMode="numeric"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
              placeholder="6-digit code"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <button
              type="submit"
              disabled={loading || totpCode.length !== 6}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Confirm and enable
            </button>
          </form>
        </section>
      )}

      {method === "none" && !totpQr && (
        <section className={cardClass}>
          <h2 className="text-lg font-semibold text-[#0f2744]">Enable SMS</h2>
          {profilePhone ? (
            <p className="text-sm text-slate-600">
              {smsProfilePhoneDescription(persona, profilePhone)}
            </p>
          ) : manualPhoneEntryAllowed ? (
            <>
              <p className="text-sm text-slate-600">
                {smsManualEntryIntro(persona)}
              </p>
              <div>
                <label
                  htmlFor="mfa-manual-phone"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Mobile number
                </label>
                <input
                  id="mfa-manual-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  placeholder="024XXXXXXX or +233XXXXXXXXX"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]"
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-amber-700">
              No phone on file — add one to your profile before enabling SMS.
            </p>
          )}
          <button
            type="button"
            onClick={handleSendSms}
            disabled={loading || !canSendSmsEnrollment || isResendCooldownActive}
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50 disabled:opacity-50"
          >
            Send verification code
          </button>
          <form onSubmit={handleConfirmSms} className="space-y-3">
            <input
              inputMode="numeric"
              maxLength={6}
              value={smsCode}
              onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, ""))}
              placeholder="6-digit SMS code"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={loading || smsCode.length !== 6}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Verify and enable SMS
            </button>
          </form>
        </section>
      )}

      {method !== "none" && (
        <section className={cardClass}>
          <h2 className="text-lg font-semibold text-[#0f2744]">
            Disable two-factor
          </h2>
          <p className="text-sm text-slate-600">
            Enter a current {method === "totp" ? "authenticator" : "SMS"} code to
            turn off two-factor authentication.
          </p>
          {method === "sms" && (
            <button
              type="button"
              onClick={async () => {
                setLoading(true);
                setError(null);
                const result = await onSendDisableSmsOtp();
                if (applySmsSendResult(result)) {
                  setSuccess("SMS code sent.");
                }
                setLoading(false);
              }}
              disabled={loading || isResendCooldownActive}
              className="text-sm text-[#0f2744] underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send SMS code
            </button>
          )}
          <form onSubmit={handleDisable} className="space-y-3">
            <input
              inputMode="numeric"
              maxLength={6}
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
              placeholder="6-digit code"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <button
              type="submit"
              disabled={loading || disableCode.length !== 6}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Disable two-factor
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
