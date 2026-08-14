import "server-only";

import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/utils/admin-auth";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { getLandlordPortalSession } from "@/utils/landlord-portal-auth";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import {
  isPushPersona,
  type PushPersona,
} from "@/utils/push-notification-types";

export type PushSubscriptionContext =
  | {
      ok: true;
      userId: string;
      tenantId: string;
      persona: PushPersona;
    }
  | { ok: false; response: NextResponse };

export async function resolvePushSubscriptionContext(
  persona: unknown,
): Promise<PushSubscriptionContext> {
  if (!isPushPersona(persona)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid persona." }, { status: 400 }),
    };
  }

  if (persona === "staff") {
    const auth = await requireAuthenticated();
    if (!auth.ok) {
      return { ok: false, response: auth.response };
    }

    const tenantId = await getCurrentUserTenantId();
    if (!tenantId || !auth.userId) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }

    return {
      ok: true,
      userId: auth.userId,
      tenantId,
      persona,
    };
  }

  if (persona === "lessee") {
    const session = await getPortalLesseeSession();
    if (!session) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    return {
      ok: true,
      userId: session.authUserId,
      tenantId: session.tenantId,
      persona,
    };
  }

  const session = await getLandlordPortalSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return {
    ok: true,
    userId: session.authUserId,
    tenantId: session.tenantId,
    persona,
  };
}
