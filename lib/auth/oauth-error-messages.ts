/**
 * Map raw Supabase/OAuth provider errors to user-friendly copy.
 */
export type OAuthErrorContext = {
  persona?: string;
  provider?: "google" | "azure" | "unknown";
};

function inferProvider(message: string): OAuthErrorContext["provider"] {
  const lower = message.toLowerCase();
  if (lower.includes("azure") || lower.includes("microsoft")) return "azure";
  if (lower.includes("google")) return "google";
  return "unknown";
}

function providerLabel(provider: OAuthErrorContext["provider"]): string {
  switch (provider) {
    case "azure":
      return "Microsoft";
    case "google":
      return "Google";
    default:
      return "your provider";
  }
}

export function mapOAuthErrorMessage(
  rawMessage: string | null | undefined,
  context?: OAuthErrorContext,
): string {
  const message = rawMessage?.trim() ?? "";
  if (!message) {
    return "We could not complete sign-in. Please try again or contact support.";
  }

  const lower = message.toLowerCase();
  const provider =
    context?.provider && context.provider !== "unknown"
      ? context.provider
      : inferProvider(message);
  const label = providerLabel(provider);

  if (
    lower.includes("unable to exchange external code") ||
    lower.includes("invalid_client") ||
    lower.includes("aadsts7000215") ||
    lower.includes("aadsts7000222")
  ) {
    if (provider === "azure") {
      return "We couldn't complete sign-in with Microsoft. Please try again or use a different sign-in method.";
    }
    if (provider === "google") {
      return "We couldn't complete sign-in with Google. Please try again or use a different sign-in method.";
    }
    return "We couldn't complete sign-in with your account provider. Please try again or use email and password.";
  }

  if (
    lower.includes("error getting user email from external provider") ||
    lower.includes("email from external provider")
  ) {
    return `We couldn't read an email address from ${label}. Make sure your account has a verified email, then try again.`;
  }

  if (lower.includes("oauth session expired") || lower.includes("flow cookie")) {
    return "Your sign-in session expired. Please start again from the login page.";
  }

  if (
    lower.includes("access_denied") ||
    lower.includes("user cancelled") ||
    lower.includes("user canceled")
  ) {
    return "Sign-in was cancelled. You can try again when you're ready.";
  }

  if (lower.includes("provider is not enabled")) {
    return `${label} sign-in is not available right now. Please use email and password or contact support.`;
  }

  if (lower.includes("invalid oauth start parameters")) {
    return "This sign-in link is invalid. Go back to the login page and try again.";
  }

  if (lower.includes("authorization code")) {
    return "Sign-in did not finish correctly. Please try again from the login page.";
  }

  if (lower.includes("no staff account is linked") || lower.includes("no lessee account") || lower.includes("no landlord account")) {
    return message;
  }

  if (lower.includes("invite was sent to") || lower.includes("invite link has expired")) {
    return message;
  }

  if (lower.includes("already linked to a staff erp account") || lower.includes("cross-persona")) {
    return message;
  }

  // Hide truncated provider codes like "M.C5" from token exchange failures.
  if (/^unable to exchange external code:\s*[^\s]{1,12}$/i.test(message)) {
    if (provider === "azure") {
      return "We couldn't complete sign-in with Microsoft. Please try again or use a different sign-in method.";
    }
    return "We couldn't complete sign-in. Please try again or use a different sign-in method.";
  }

  return message;
}
