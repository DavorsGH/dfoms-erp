import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { CRM_SECTION_ROLES, POS_SECTION_ROLES, FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { fireTransactionalNotification } from "@/utils/transactional-notification-trigger";
import {
  TRANSACTIONAL_EVENT_TYPES,
  type TransactionalEventType,
} from "@/utils/transactional-notification-types";

/**
 * Authenticated trigger for client-side flows (e.g. POS cash checkout).
 * Server paths should call fireTransactionalNotification directly.
 */
export async function POST(request: Request) {
  const auth = await requireTenantRoleIn([
    ...CRM_SECTION_ROLES,
    ...POS_SECTION_ROLES,
    ...FINANCE_SECTION_ROLES,
  ]);
  if (!auth.ok) {
    return auth.response;
  }

  let body: {
    event_type?: string;
    customer_id?: string | null;
    variables?: Record<string, string>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const eventType = body.event_type?.trim() ?? "";
  if (
    !(TRANSACTIONAL_EVENT_TYPES as readonly string[]).includes(eventType)
  ) {
    return NextResponse.json({ error: "Invalid event_type." }, { status: 400 });
  }

  // Best-effort: fire never throws; await so logs land before the response ends.
  await fireTransactionalNotification(
    auth.tenantId,
    eventType as TransactionalEventType,
    body.customer_id,
    body.variables ?? {},
  );

  return NextResponse.json({ ok: true });
}
