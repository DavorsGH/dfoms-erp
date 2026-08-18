import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sanitizeActivityMetadata } from "./user-activity-log-sanitize";
import type {
  UserActivityEventName,
  UserActivityPersona,
  UserActivityStatus,
} from "./user-activity-log-types";

export type LogUserActivityInput = {
  persona: UserActivityPersona;
  eventName: UserActivityEventName | string;
  status: UserActivityStatus;
  email?: string | null;
  ip?: string | null;
  tenantId?: string | null;
  authUserId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type LogAuthActivityInput = {
  persona: UserActivityPersona;
  eventName: UserActivityEventName;
  status: UserActivityStatus;
  email?: string | null;
  ip?: string | null;
  tenantId?: string | null;
  authUserId?: string | null;
  method?: "password" | "oauth" | "sms_mfa" | "totp_mfa";
  failureReason?: string | null;
};

function createServiceRoleClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin credentials");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function logUserActivity(
  input: LogUserActivityInput,
  admin: SupabaseClient = createServiceRoleClient(),
): Promise<void> {
  try {
    const email = input.email?.trim().toLowerCase() || null;
    const ip = input.ip?.trim() || null;

    const { error } = await admin.from("user_activity_log").insert({
      persona: input.persona,
      tenant_id: input.tenantId ?? null,
      auth_user_id: input.authUserId ?? null,
      email,
      event_name: input.eventName,
      status: input.status,
      ip,
      metadata: sanitizeActivityMetadata(input.metadata),
    });

    if (error) {
      console.error(
        `[user-activity-log] insert failed (${input.eventName}/${input.status}):`,
        error.message,
      );
    }
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown logging error";
    console.error(
      `[user-activity-log] unexpected failure (${input.eventName}/${input.status}):`,
      detail,
    );
  }
}

export function logAuthActivity(input: LogAuthActivityInput): void {
  const metadata: Record<string, unknown> = {};
  if (input.method) {
    metadata.method = input.method;
  }
  if (input.failureReason?.trim()) {
    metadata.failure_reason = input.failureReason.trim().slice(0, 500);
  }

  void logUserActivity({
    persona: input.persona,
    eventName: input.eventName,
    status: input.status,
    email: input.email,
    ip: input.ip,
    tenantId: input.tenantId,
    authUserId: input.authUserId,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  });
}

export async function resolveAuthActivityTenantId(
  options: {
    persona: UserActivityPersona;
    authUserId: string;
  },
  admin: SupabaseClient = createServiceRoleClient(),
): Promise<string | null> {
  try {
    if (options.persona === "staff") {
      const { data } = await admin
        .from("user_accounts")
        .select("tenant_id")
        .eq("auth_uid", options.authUserId)
        .maybeSingle();
      return data?.tenant_id ?? null;
    }

    if (options.persona === "lessee") {
      const { data } = await admin
        .from("lessees")
        .select("tenant_id")
        .eq("auth_user_id", options.authUserId)
        .maybeSingle();
      return data?.tenant_id ?? null;
    }

    const { data } = await admin
      .from("landlords")
      .select("tenant_id")
      .eq("auth_user_id", options.authUserId)
      .maybeSingle();
    return data?.tenant_id ?? null;
  } catch (error) {
    console.error(
      "[user-activity-log] tenant lookup failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
