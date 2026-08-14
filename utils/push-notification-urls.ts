import { resolvePublicSiteUrl } from "@/utils/public-site-url";
import type { PushPersona } from "@/utils/push-notification-types";

/** Resolve a notification deep link for device push click-through. */
export function resolvePushNotificationUrl(
  persona: PushPersona,
  actionUrl: string | null | undefined,
): string {
  const origin = resolvePublicSiteUrl();
  const fallback =
    persona === "staff"
      ? "/dashboard"
      : persona === "lessee"
        ? "/portal/dashboard"
        : "/landlord-portal/dashboard";

  const raw = actionUrl?.trim() || fallback;
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `${origin}${path}`;
}

export function defaultPushInboxUrl(persona: PushPersona): string {
  return resolvePushNotificationUrl(persona, null);
}
