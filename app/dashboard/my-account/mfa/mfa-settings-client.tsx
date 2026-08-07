"use client";

import MfaSettingsPanel from "@/components/mfa/mfa-settings-panel";
import {
  staffConfirmSmsEnrollment,
  staffConfirmTotpEnrollment,
  staffDisableMfa,
  staffSendDisableSmsOtp,
  staffSendSmsEnrollmentOtp,
  staffStartTotpEnrollment,
} from "./actions";

type Settings = Awaited<
  ReturnType<typeof import("./actions").staffGetMfaSettings>
>;

export default function StaffMfaSettingsClient({
  initialSettings,
}: {
  initialSettings: Settings;
}) {
  return (
    <MfaSettingsPanel
      persona="staff"
      initialSettings={initialSettings}
      onStartTotp={staffStartTotpEnrollment}
      onConfirmTotp={staffConfirmTotpEnrollment}
      onSendSmsOtp={staffSendSmsEnrollmentOtp}
      onConfirmSms={staffConfirmSmsEnrollment}
      onDisable={staffDisableMfa}
      onSendDisableSmsOtp={staffSendDisableSmsOtp}
    />
  );
}
