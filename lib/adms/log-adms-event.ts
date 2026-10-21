import "server-only";

import { logSystemEvent } from "@/lib/system-event-log";

export async function logAdmsEvent(input: {
  eventName: string;
  status: "success" | "failure" | "warning";
  message?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await logSystemEvent({
    eventType: "webhook",
    eventName: input.eventName,
    status: input.status,
    message: input.message,
    metadata: {
      source: "adms",
      ...(input.metadata ?? {}),
    },
  });
}
