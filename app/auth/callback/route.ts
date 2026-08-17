import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { dispatchOAuthCallback } from "@/lib/auth/oauth-callback-dispatch";
import {
  clearOAuthFlowCookie,
  readOAuthFlowCookie,
} from "@/lib/auth/oauth-flow-cookie";
import { defaultDashboardForPersona } from "@/lib/auth/oauth-types";
import { normalizeOAuthEmail } from "@/lib/auth/oauth-persona-resolve";
import { mapOAuthErrorMessage } from "@/lib/auth/oauth-error-messages";
import { completePlatformSignOut } from "@/lib/auth/sign-out";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

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

  const flow = await readOAuthFlowCookie();

  if (oauthError) {
    await clearOAuthFlowCookie();
    return oauthErrorRedirect(
      flow?.persona ?? "staff",
      oauthError,
      request.url,
      flow?.provider,
    );
  }

  if (!code) {
    await clearOAuthFlowCookie();
    return oauthErrorRedirect(
      flow?.persona ?? "staff",
      "OAuth sign-in did not return an authorization code.",
      request.url,
    );
  }

  if (!flow) {
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
    return oauthErrorRedirect(
      flow.persona,
      "OAuth sign-in did not return a valid user.",
      request.url,
    );
  }

  const admin = createAdminClient();
  const oauthEmail = normalizeOAuthEmail(user.email);

  const result = await dispatchOAuthCallback(admin, user.id, oauthEmail, flow);
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
