import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import {
  fetchUserBusinessUnitAccessForAdmin,
  normalizeBusinessUnitAccessInput,
  syncUserBusinessUnitAccess,
} from "@/utils/admin-user-business-unit-access";
import { createAdminClient } from "@/utils/supabase/admin";

type ReplaceAccessBody = {
  auth_uid?: string;
  business_unit_ids?: unknown;
  default_business_unit_id?: unknown;
};

async function ensureAccountInTenant(
  admin: ReturnType<typeof createAdminClient>,
  authUid: string,
  tenantId: string,
) {
  const { data: account, error } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", authUid)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  }

  if (!account) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "User account not found" }, { status: 404 }),
    };
  }

  return { ok: true as const };
}

export async function GET(request: Request) {
  try {
    const auth = await requireTenantSuperAdmin();
    if (!auth.ok) {
      return auth.response;
    }

    const { tenantId } = auth;
    const authUid = new URL(request.url).searchParams.get("auth_uid");
    if (!authUid) {
      return NextResponse.json({ error: "auth_uid is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const accountCheck = await ensureAccountInTenant(admin, authUid, tenantId);
    if (!accountCheck.ok) {
      return accountCheck.response;
    }

    const access = await fetchUserBusinessUnitAccessForAdmin(
      admin,
      tenantId,
      authUid,
    );

    return NextResponse.json(access);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected business-unit-access server error.";
    console.error("[admin/users/business-unit-access] GET failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function replaceBusinessUnitAccess(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

  let body: ReplaceAccessBody;
  try {
    body = (await request.json()) as ReplaceAccessBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const authUid = body.auth_uid?.trim();
  if (!authUid) {
    return NextResponse.json({ error: "auth_uid is required" }, { status: 400 });
  }

  const normalized = normalizeBusinessUnitAccessInput(body);
  if ("error" in normalized) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const admin = createAdminClient();
  const accountCheck = await ensureAccountInTenant(admin, authUid, tenantId);
  if (!accountCheck.ok) {
    return accountCheck.response;
  }

  const syncError = await syncUserBusinessUnitAccess(
    admin,
    authUid,
    tenantId,
    normalized,
  );

  if (syncError) {
    const status =
      syncError.includes("invalid for this workspace") ||
      syncError.includes("Select a default business unit")
        ? 400
        : 500;
    return NextResponse.json({ error: syncError }, { status });
  }

  const access = await fetchUserBusinessUnitAccessForAdmin(
    admin,
    tenantId,
    authUid,
  );

  return NextResponse.json({ success: true, ...access });
}

export async function PUT(request: Request) {
  try {
    return await replaceBusinessUnitAccess(request);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected business-unit-access server error.";
    console.error("[admin/users/business-unit-access] PUT failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    return await replaceBusinessUnitAccess(request);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected business-unit-access server error.";
    console.error("[admin/users/business-unit-access] POST failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
