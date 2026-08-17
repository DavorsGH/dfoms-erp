import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  clearOAuthFlowCookie,
  readOAuthFlowCookie,
  setOAuthFlowCookie,
} from "@/lib/auth/oauth-flow-cookie";
import {
  parseOAuthFlow,
  parseOAuthPersona,
  parseOAuthProvider,
  type OAuthFlowPayload,
  type OAuthSignupFields,
} from "@/lib/auth/oauth-types";
import { resolvePublicSiteUrl } from "@/utils/public-site-url";
import { createClient } from "@/utils/supabase/server";
import { getSafeNext } from "@/utils/safe-redirect";

function oauthErrorRedirect(
  persona: string,
  message: string,
  requestUrl: string,
): NextResponse {
  const params = new URLSearchParams();
  params.set("persona", persona);
  params.set("message", message);
  return NextResponse.redirect(new URL(`/auth/error?${params.toString()}`, requestUrl));
}

function buildSignupFields(searchParams: URLSearchParams): OAuthSignupFields | undefined {
  const company_name = searchParams.get("company_name")?.trim();
  const admin_full_name = searchParams.get("admin_full_name")?.trim();
  const admin_email = searchParams.get("admin_email")?.trim();
  const name = searchParams.get("name")?.trim();
  const email = searchParams.get("email")?.trim();
  const phone = searchParams.get("phone")?.trim();
  const address = searchParams.get("address")?.trim();

  if (
    !company_name &&
    !admin_full_name &&
    !admin_email &&
    !name &&
    !email &&
    !phone &&
    !address
  ) {
    return undefined;
  }

  return {
    company_name,
    admin_full_name,
    admin_email,
    name,
    email,
    phone,
    address,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = parseOAuthProvider(url.searchParams.get("provider"));
  const persona = parseOAuthPersona(url.searchParams.get("persona"));
  const flow = parseOAuthFlow(url.searchParams.get("flow"));

  if (!provider || !persona || !flow) {
    return oauthErrorRedirect(
      persona ?? "staff",
      "Invalid OAuth start parameters.",
      request.url,
    );
  }

  const payload: OAuthFlowPayload = {
    persona,
    flow,
    invite_token: url.searchParams.get("invite_token")?.trim() || undefined,
    signup: buildSignupFields(url.searchParams),
    next: getSafeNext(url.searchParams.get("next"), ""),
    issued_at: Date.now(),
  };

  if (flow === "accept_invite" && !payload.invite_token) {
    return oauthErrorRedirect(
      persona,
      "Invite token is required for invite acceptance.",
      request.url,
    );
  }

  try {
    await setOAuthFlowCookie(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OAuth flow cookie failed.";
    return oauthErrorRedirect(persona, message, request.url);
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const siteUrl = resolvePublicSiteUrl().replace(/\/$/, "");
  const redirectTo = `${siteUrl}/auth/callback`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      queryParams:
        provider === "azure"
          ? { prompt: "select_account" }
          : { prompt: "consent", access_type: "offline" },
    },
  });

  if (error || !data.url) {
    await clearOAuthFlowCookie();
    return oauthErrorRedirect(
      persona,
      error?.message ?? "Unable to start OAuth sign-in.",
      request.url,
    );
  }

  return NextResponse.redirect(data.url);
}
