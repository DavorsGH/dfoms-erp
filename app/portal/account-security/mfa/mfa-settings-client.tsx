"use client";

import MfaSettingsPanel from "@/components/mfa/mfa-settings-panel";
import {
  portalConfirmSmsEnrollment,
  portalConfirmTotpEnrollment,
  portalDisableMfa,
  portalSendDisableSmsOtp,
  portalSendSmsEnrollmentOtp,
  portalStartTotpEnrollment,
} from "./actions";

type Settings = Awaited<
  ReturnType<typeof import("./actions").portalGetMfaSettings>
>;

export default function PortalMfaSettingsClient({
  initialSettings,
}: {
  initialSettings: Settings;
}) {
  return (
    <MfaSettingsPanel
      persona="lessee"
      initialSettings={initialSettings}
      onStartTotp={portalStartTotpEnrollment}
      onConfirmTotp={portalConfirmTotpEnrollment}
      onSendSmsOtp={portalSendSmsEnrollmentOtp}
      onConfirmSms={portalConfirmSmsEnrollment}
      onDisable={portalDisableMfa}
      onSendDisableSmsOtp={portalSendDisableSmsOtp}
    />
  );
}
