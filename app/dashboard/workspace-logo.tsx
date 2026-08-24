"use client";

import { useEffect, useState } from "react";
import { getInitialsFromName } from "@/utils/employee-photo";
import { offlineWorkspaceLogoSrc } from "@/lib/client-cache/offline-shell-assets";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useTenantBranding } from "./tenant-branding-context";

type WorkspaceLogoProps = {
  workspaceLogoUrl?: string;
  /** Workspace or legal name — used for alt text and initials fallback. */
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  rounded?: "sm" | "md" | "lg";
};

const sizeClasses = {
  xs: "h-7 w-7 text-[8px]",
  sm: "h-9 w-9 text-xs",
  md: "h-16 w-16 text-sm",
  lg: "h-20 w-20 text-base",
  xl: "h-24 w-24 text-lg",
} as const;

const roundedClasses = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
} as const;

function truncateTenantName(name: string, maxLength: number): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export default function WorkspaceLogo({
  workspaceLogoUrl: workspaceLogoUrlProp,
  name: nameProp,
  size = "md",
  className = "",
  rounded = "md",
}: WorkspaceLogoProps) {
  const branding = useTenantBranding();
  const isOnline = useOnlineStatus();
  const [imageFailed, setImageFailed] = useState(false);

  const workspaceLogoUrl =
    workspaceLogoUrlProp ?? branding.workspaceLogoUrl;
  const name =
    nameProp ?? branding.workspaceName ?? branding.companyLegalName;

  const logoSrc = offlineWorkspaceLogoSrc(isOnline, workspaceLogoUrl);
  const sizeClass = sizeClasses[size];
  const roundedClass = roundedClasses[rounded];
  const initials = getInitialsFromName(name);

  useEffect(() => {
    setImageFailed(false);
  }, [workspaceLogoUrl, isOnline]);

  if (logoSrc.trim() && !imageFailed) {
    return (
      // Plain <img> so SW-cached /__offline_assets/... paths work offline.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoSrc}
        alt={name ? `${name} logo` : "Workspace logo"}
        className={`${sizeClass} ${roundedClass} shrink-0 object-cover bg-slate-100 ${className}`}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} ${roundedClass} flex shrink-0 items-center justify-center bg-[#0f2744] px-1 text-center font-semibold leading-tight text-white ${className}`}
      aria-hidden={!name}
      title={name ?? undefined}
    >
      {initials ? (
        <span>{initials}</span>
      ) : name ? (
        <span className="text-[0.65em] font-medium">
          {truncateTenantName(name, size === "xs" ? 8 : 12)}
        </span>
      ) : null}
    </div>
  );
}
