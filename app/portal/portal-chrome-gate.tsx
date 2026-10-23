"use client";

import { usePathname } from "next/navigation";

const CHROME_FREE_PREFIXES = [
  "/portal/login",
  "/portal/forgot-password",
  "/portal/reset-password",
  "/portal/set-password",
  "/portal/accept-invite",
] as const;

function isChromeFreePath(pathname: string): boolean {
  return CHROME_FREE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Renders children only on authenticated portal pages (hides assistant on auth flows). */
export default function PortalChromeGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (isChromeFreePath(pathname)) {
    return null;
  }
  return <>{children}</>;
}
