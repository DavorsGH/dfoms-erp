"use client";

import type {
  OAuthFlow,
  OAuthPersona,
  OAuthSignupFields,
} from "@/lib/auth/oauth-types";

type OAuthProviderButtonsProps = {
  persona: OAuthPersona;
  flow: OAuthFlow;
  inviteToken?: string | null;
  signupFields?: OAuthSignupFields;
  next?: string | null;
  disabled?: boolean;
};

function buildStartUrl(
  provider: "google" | "azure",
  props: OAuthProviderButtonsProps,
): string {
  const params = new URLSearchParams();
  params.set("provider", provider);
  params.set("persona", props.persona);
  params.set("flow", props.flow);

  if (props.inviteToken?.trim()) {
    params.set("invite_token", props.inviteToken.trim());
  }
  if (props.next?.trim()) {
    params.set("next", props.next.trim());
  }

  const signup = props.signupFields;
  if (signup?.company_name) params.set("company_name", signup.company_name);
  if (signup?.admin_full_name) params.set("admin_full_name", signup.admin_full_name);
  if (signup?.admin_email) params.set("admin_email", signup.admin_email);
  if (signup?.name) params.set("name", signup.name);
  if (signup?.email) params.set("email", signup.email);
  if (signup?.phone) params.set("phone", signup.phone);
  if (signup?.address) params.set("address", signup.address);

  return `/auth/start?${params.toString()}`;
}

export default function OAuthProviderButtons(props: OAuthProviderButtonsProps) {
  const disabled = props.disabled ?? false;

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-zinc-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-zinc-500">Or continue with</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <a
          href={buildStartUrl("google", props)}
          aria-disabled={disabled}
          className={`inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 ${disabled ? "pointer-events-none opacity-50" : ""}`}
        >
          Google
        </a>
        <a
          href={buildStartUrl("azure", props)}
          aria-disabled={disabled}
          className={`inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 ${disabled ? "pointer-events-none opacity-50" : ""}`}
        >
          Microsoft
        </a>
      </div>
    </div>
  );
}
