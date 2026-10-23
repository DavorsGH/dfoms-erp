import "server-only";

import { NextResponse } from "next/server";
import {
  changePortalLoginEmail,
  createPortalLogin,
  getPortalLoginAccessStatus,
  listFacilityManagersForLandlordLoginAccess,
  listTenantSuperAdminsForLoginAccess,
  sendPortalLoginResetLink,
  setPortalLoginTemporaryPassword,
  type ActionContext,
} from "./actions";
import {
  requireDavorsPlatformSuperAdminServiceRole,
  requirePlatformOnlyLandlordPortal,
  requireTenantSuperAdminServiceRole,
} from "./auth-gates";
import { parsePortalLoginTargetFromBody } from "./parse-target";
import { parseVerificationFields } from "./verification";
import type { PortalLoginTargetRef } from "./types";

type ActorPath = "admin" | "landlord" | "tenant_admin";

async function resolveContext(
  path: ActorPath,
): Promise<
  | { ok: true; ctx: ActionContext }
  | { ok: false; response: NextResponse }
> {
  if (path === "admin") {
    const auth = await requireDavorsPlatformSuperAdminServiceRole();
    if (!auth.ok) return auth;
    return {
      ok: true,
      ctx: {
        actorPath: "admin",
        actorAuthUid: auth.actorAuthUid,
        actorTenantId: auth.actorTenantId,
        actorPersona: "davors_admin",
      },
    };
  }

  if (path === "tenant_admin") {
    const auth = await requireTenantSuperAdminServiceRole();
    if (!auth.ok) return auth;
    return {
      ok: true,
      ctx: {
        actorPath: "tenant_admin",
        actorAuthUid: auth.actorAuthUid,
        actorTenantId: auth.actorTenantId,
        actorPersona: "tenant_admin",
      },
    };
  }

  const auth = await requirePlatformOnlyLandlordPortal();
  if (!auth.ok) return auth;
  return {
    ok: true,
    ctx: {
      actorPath: "landlord",
      actorAuthUid: auth.actorAuthUid,
      actorTenantId: auth.actorTenantId,
      actorPersona: "landlord",
    },
  };
}

function parseTargetFromQuery(
  searchParams: URLSearchParams,
):
  | { ok: true; ref: PortalLoginTargetRef }
  | { ok: false; error: string } {
  return parsePortalLoginTargetFromBody({
    persona: searchParams.get("persona") ?? "",
    tenant_id: searchParams.get("tenant_id") ?? "",
    lessee_id: searchParams.get("lessee_id") ?? "",
    facility_manager_id: searchParams.get("facility_manager_id") ?? "",
    auth_uid: searchParams.get("auth_uid") ?? "",
  });
}

function failureResponse(result: {
  error: string;
  status: number;
  code?: string;
  sharedLinks?: unknown;
  field?: string;
}) {
  return NextResponse.json(
    {
      error: result.error,
      code: result.code,
      shared_links: result.sharedLinks,
      field: result.field,
    },
    { status: result.status },
  );
}

function assertPathMayTarget(
  path: ActorPath,
  ctx: ActionContext,
  ref: PortalLoginTargetRef,
): NextResponse | null {
  if (path === "landlord") {
    if (ref.persona === "landlord" || ref.persona === "staff") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (ref.tenantId !== ctx.actorTenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (path === "tenant_admin") {
    if (ref.persona !== "staff") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (ref.tenantId !== ctx.actorTenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return null;
}

export async function handlePortalLoginAccessStatusGet(
  request: Request,
  path: ActorPath,
) {
  const gate = await resolveContext(path);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const parsed = parseTargetFromQuery(url.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const denied = assertPathMayTarget(path, gate.ctx, parsed.ref);
  if (denied) return denied;

  const result = await getPortalLoginAccessStatus(gate.ctx, parsed.ref);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ status: result.status });
}

export async function handlePortalLoginAccessResetLinkPost(
  request: Request,
  path: ActorPath,
) {
  const gate = await resolveContext(path);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parsePortalLoginTargetFromBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const denied = assertPathMayTarget(path, gate.ctx, parsed.ref);
  if (denied) return denied;

  const verification = parseVerificationFields(body);
  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.error, field: verification.field },
      { status: 400 },
    );
  }

  const result = await sendPortalLoginResetLink(gate.ctx, {
    ref: parsed.ref,
    verificationMethod: verification.verificationMethod,
    reason: verification.reason,
    confirmSharedLogin: body.confirm_shared_login === true,
  });
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ success: true, message: result.message });
}

export async function handlePortalLoginAccessTempPasswordPost(
  request: Request,
  path: ActorPath,
) {
  const gate = await resolveContext(path);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parsePortalLoginTargetFromBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const denied = assertPathMayTarget(path, gate.ctx, parsed.ref);
  if (denied) return denied;

  const verification = parseVerificationFields(body);
  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.error, field: verification.field },
      { status: 400 },
    );
  }

  const password =
    typeof body.password === "string" ? body.password : "";
  const result = await setPortalLoginTemporaryPassword(gate.ctx, {
    ref: parsed.ref,
    password,
    verificationMethod: verification.verificationMethod,
    reason: verification.reason,
    confirmSharedLogin: body.confirm_shared_login === true,
  });
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({
    success: true,
    message: result.message,
    notification_failed: result.notificationFailed === true,
  });
}

export async function handlePortalLoginAccessChangeEmailPost(
  request: Request,
  path: ActorPath,
) {
  const gate = await resolveContext(path);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parsePortalLoginTargetFromBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const denied = assertPathMayTarget(path, gate.ctx, parsed.ref);
  if (denied) return denied;

  const verification = parseVerificationFields(body);
  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.error, field: verification.field },
      { status: 400 },
    );
  }

  const newEmail = typeof body.email === "string" ? body.email : "";
  const result = await changePortalLoginEmail(gate.ctx, {
    ref: parsed.ref,
    newEmail,
    alsoUpdateProfileEmail: body.also_update_profile_email === true,
    verificationMethod: verification.verificationMethod,
    reason: verification.reason,
    confirmSharedLogin: body.confirm_shared_login === true,
  });
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({
    success: true,
    message: result.message,
    notification_failed: result.notificationFailed === true,
  });
}

export async function handlePortalLoginAccessCreateLoginPost(
  request: Request,
  path: ActorPath,
) {
  const gate = await resolveContext(path);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parsePortalLoginTargetFromBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const denied = assertPathMayTarget(path, gate.ctx, parsed.ref);
  if (denied) return denied;

  const verification = parseVerificationFields(body);
  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.error, field: verification.field },
      { status: 400 },
    );
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const result = await createPortalLogin(gate.ctx, {
    ref: parsed.ref,
    email,
    password,
    verificationMethod: verification.verificationMethod,
    reason: verification.reason,
  });
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({
    success: true,
    message: result.message,
    notification_failed: result.notificationFailed === true,
  });
}

export async function handleAdminFacilityManagersLoginAccessGet(
  request: Request,
) {
  const gate = await resolveContext("admin");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant_id")?.trim() ?? "";
  if (!tenantId) {
    return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
  }

  const result = await listFacilityManagersForLandlordLoginAccess(
    gate.ctx,
    tenantId,
  );
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ facility_managers: result.rows });
}

export async function handleAdminTenantSuperAdminsLoginAccessGet(
  request: Request,
) {
  const gate = await resolveContext("admin");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant_id")?.trim() ?? "";
  if (!tenantId) {
    return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
  }

  const result = await listTenantSuperAdminsForLoginAccess(gate.ctx, tenantId);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ super_admins: result.rows });
}
