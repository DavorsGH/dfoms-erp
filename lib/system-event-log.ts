import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";

export type SystemEventType = "webhook" | "cron" | "payment";
export type SystemEventStatus = "success" | "failure" | "warning";

export type LogSystemEventInput = {
  eventType: SystemEventType;
  eventName: string;
  status: SystemEventStatus;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Inserts a row into system_event_log via service_role.
 * Never throws — logging failures are swallowed and console-logged.
 */
export async function logSystemEvent(input: LogSystemEventInput): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("system_event_log").insert({
      event_type: input.eventType,
      event_name: input.eventName,
      status: input.status,
      message: input.message ?? null,
      metadata: input.metadata ?? null,
    });

    if (error) {
      console.error(
        `[system-event-log] insert failed (${input.eventName}/${input.status}):`,
        error.message,
      );
    }
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown logging error";
    console.error(
      `[system-event-log] unexpected failure (${input.eventName}/${input.status}):`,
      detail,
    );
  }
}
