import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import { logUserActivity } from "@/utils/user-activity-log-write";

export async function logInventoryUserActivity(input: {
  tenantId: string;
  authUserId: string;
  email?: string | null;
  eventName: string;
  status: "success" | "failure";
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await logUserActivity(
    {
      persona: "staff",
      eventName: input.eventName,
      status: input.status,
      tenantId: input.tenantId,
      authUserId: input.authUserId,
      email: input.email,
      metadata: input.metadata,
    },
    createAdminClient(),
  );
}
