"use client";

import MfaSettingsPanel from "@/components/mfa/mfa-settings-panel";
import {
  landlordConfirmSmsEnrollment,
  landlordConfirmTotpEnrollment,
  landlordDisableMfa,
  landlordSendDisableSmsOtp,
  landlordSendSmsEnrollmentOtp,
  landlordStartTotpEnrollment,
} from "./actions";

type Settings = Awaited<
  ReturnType<typeof import("./actions").landlordGetMfaSettings>
>;

export default function LandlordMfaSettingsClient({
  initialSettings,
}: {
  initialSettings: Settings;
}) {
  return (
    <MfaSettingsPanel
      persona="landlord"
      initialSettings={initialSettings}
      onStartTotp={landlordStartTotpEnrollment}
      onConfirmTotp={landlordConfirmTotpEnrollment}
      onSendSmsOtp={landlordSendSmsEnrollmentOtp}
      onConfirmSms={landlordConfirmSmsEnrollment}
      onDisable={landlordDisableMfa}
      onSendDisableSmsOtp={landlordSendDisableSmsOtp}
    />
  );
}
