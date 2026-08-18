import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { dispatchOAuthCallback } from "@/lib/auth/oauth-callback-dispatch";
import {
  clearOAuthFlowCookie,
  readOAuthFlowCookie,
} from "@/lib/auth/oauth-flow-cookie";
import { normalizeOAuthEmail } from "@/lib/auth/oauth-persona-resolve";
import { mapOAuthErrorMessage } from "@/lib/auth/oauth-error-messages";
import { completePlatformSignOut } from "@/lib/auth/sign-out";
import { logAuthActivity } from "@/lib/user-activity-log";
import { getRequestIp } from "@/utils/login-rate-limit";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import type { UserActivityPersona } from "@/utils/user-activity-log-types";

function oauthPersona(value: string | undefined): UserActivityPersona {
  if (value === "lessee" || value === "landlord" || value === "staff") {
    return value;
  }
  return "staff";
}

function logOAuthCallbackFailure(
  persona: UserActivityPersona,
  options: {
    ip: string;
    email?: string | null;
    authUserId?: string | null;
    failureReason: string;
  },
): void {
  logAuthActivity({
    persona,
    eventName: "login.oauth_failure",
    status: "failure",
    email: options.email,
    ip: options.ip,
    authUserId: options.authUserId,
    method: "oauth",
    failureReason: options.failureReason,
  });
}

function oauthErrorRedirect(
  persona: string,
  message: string,
  requestUrl: string,
  provider?: "google" | "azure",
): NextResponse {
  const params = new URLSearchParams();
  params.set("persona", persona);
  params.set(
    "message",
    mapOAuthErrorMessage(message, { persona, provider }),
  );
  return NextResponse.redirect(new URL(`/auth/error?${params.toString()}`, requestUrl));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const headerStore = await headers();
  const ip = getRequestIp(headerStore);

  const flow = await readOAuthFlowCookie();

  if (oauthError) {
    await clearOAuthFlowCookie();
    logOAuthCallbackFailure(oauthPersona(flow?.persona), {
      ip,
      failureReason: oauthError,
    });
    return oauthErrorRedirect(
      flow?.persona ?? "staff",
      oauthError,
      request.url,
      flow?.provider,
    );
  }

  if (!code) {
    await clearOAuthFlowCookie();
    logOAuthCallbackFailure(oauthPersona(flow?.persona), {
      ip,
      failureReason: "missing_authorization_code",
    });
    return oauthErrorRedirect(
      flow?.persona ?? "staff",
      "OAuth sign-in did not return an authorization code.",
      request.url,
    );
  }

  if (!flow) {
    logOAuthCallbackFailure("staff", {
      ip,
      failureReason: "oauth_session_expired",
    });
    return oauthErrorRedirect(
      "staff",
      "OAuth session expired. Please try signing in again.",
      request.url,
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    await clearOAuthFlowCookie();
    logOAuthCallbackFailure(flow.persona, {
      ip,
      failureReason: exchangeError.message,
    });
    return oauthErrorRedirect(
      flow.persona,
      exchangeError.message,
      request.url,
      flow.provider,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !user.email) {
    await clearOAuthFlowCookie();
    await completePlatformSignOut();
    logOAuthCallbackFailure(flow.persona, {
      ip,
      authUserId: user?.id ?? null,
      failureReason: "invalid_oauth_user",
    });
    return oauthErrorRedirect(
      flow.persona,
      "OAuth sign-in did not return a valid user.",
      request.url,
    );
  }

  const admin = createAdminClient();
  const oauthEmail = normalizeOAuthEmail(user.email);

  const result = await dispatchOAuthCallback(admin, user.id, oauthEmail, flow, {
    ip,
  });
  await clearOAuthFlowCookie();

  if (!result.ok) {
    await completePlatformSignOut();
    return oauthErrorRedirect(
      result.persona,
      result.error,
      request.url,
      flow.provider,
    );
  }

  return NextResponse.redirect(new URL(result.redirectTo, request.url));
}
