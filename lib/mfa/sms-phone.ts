import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import { toGhanaE164 } from "./phone-utils";
import type { MfaPersona } from "./types";

function pickFirstPhone(...candidates: (string | null | undefined)[]): string | null {
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const e164 = toGhanaE164(trimmed);
    if (e164) return e164;
  }
  return null;
}

export async function resolveSmsPhoneForPersona(
  authUid: string,
  persona: MfaPersona,
): Promise<{ phoneE164: string | null; source: string | null }> {
  const admin = createAdminClient();

  if (persona === "staff") {
    // Employee directory phone only. When absent, SMS enrollment accepts manual
    // entry in the staff My Account MFA UI (stored in user_mfa_settings).
    const { data: account } = await admin
      .from("user_accounts")
      .select("employee_id")
      .eq("auth_uid", authUid)
      .maybeSingle();

    if (!account?.employee_id) {
      return { phoneE164: null, source: null };
    }

    const { data: employee } = await admin
      .from("employees")
      .select("phone, momo_number")
      .eq("employee_id", account.employee_id)
      .maybeSingle();

    const phoneE164 = pickFirstPhone(employee?.phone, employee?.momo_number);
    return {
      phoneE164,
      source: phoneE164 ? "employees.phone" : null,
    };
  }

  if (persona === "lessee") {
    const { data: lessee } = await admin
      .from("lessees")
      .select("phone")
      .eq("auth_user_id", authUid)
      .maybeSingle();

    const phoneE164 = pickFirstPhone(lessee?.phone);
    return {
      phoneE164,
      source: phoneE164 ? "lessees.phone" : null,
    };
  }

  if (persona === "facility_manager") {
    const { data: fm } = await admin
      .from("facility_managers")
      .select("phone")
      .eq("auth_user_id", authUid)
      .eq("status", "active")
      .maybeSingle();

    const phoneE164 = pickFirstPhone(fm?.phone);
    return {
      phoneE164,
      source: phoneE164 ? "facility_managers.phone" : null,
    };
  }

  const { data: landlord } = await admin
    .from("landlords")
    .select("notification_phone, tenant_id")
    .eq("auth_user_id", authUid)
    .maybeSingle();

  let tenantPhone: string | null = null;
  if (landlord?.tenant_id) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("phone")
      .eq("id", landlord.tenant_id)
      .maybeSingle();
    tenantPhone =
      typeof tenant?.phone === "string" ? tenant.phone.trim() || null : null;
  }

  const phoneE164 = pickFirstPhone(
    landlord?.notification_phone,
    tenantPhone,
  );
  return {
    phoneE164,
    source: phoneE164 ? "landlords.notification_phone" : null,
  };
}

export async function resolveEnrolledSmsPhone(
  authUid: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_mfa_settings")
    .select("sms_phone_e164, method")
    .eq("auth_uid", authUid)
    .maybeSingle();

  if (data?.method === "sms" && data.sms_phone_e164) {
    return data.sms_phone_e164;
  }
  return null;
}
