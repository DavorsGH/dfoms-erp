"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  employeePhotoSignedUrlEndpoint,
  getInitialsFromName,
  isEmployeePhotoStorageReference,
} from "@/utils/employee-photo";
import {
  getCachedEmployeePhotoSignedUrl,
  subscribeEmployeePhotoSignedUrlCache,
} from "@/utils/employee-photo-signed-url-cache";
import { offlineAvatarSrc } from "@/lib/client-cache/offline-shell-assets";
import { useOnlineStatus } from "@/hooks/use-online-status";

/** Matches header user menu avatars (`rounded-lg`, square, object-cover). */
export const EMPLOYEE_AVATAR_CORNER_CLASS = "rounded-lg";

type EmployeePhotoAvatarProps = {
  photoUrl?: string | null;
  employeeId?: string | null;
  fullName?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "header";
  className?: string;
  /**
   * `standard` — rounded square (default, same as header menu).
   * `passport` — tighter radius for printed ID card photo slot only.
   */
  frame?: "standard" | "passport";
  /** When true, resolve storage photos from the batch cache (no per-avatar GET). */
  useBatchSignedUrls?: boolean;
};

const sizeClasses = {
  xs: "h-7 w-7 text-[10px]",
  sm: "h-9 w-9 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-16 w-16 text-base",
  xl: "h-24 w-24 text-xl",
  header: "h-14 w-14 text-sm",
} as const;

function PersonSilhouetteIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}

function useBatchSignedUrl(employeeId: string | null | undefined): string | null {
  return useSyncExternalStore(
    subscribeEmployeePhotoSignedUrlCache,
    () => getCachedEmployeePhotoSignedUrl(employeeId ?? undefined),
    () => null,
  );
}

export default function EmployeePhotoAvatar({
  photoUrl,
  employeeId,
  fullName,
  size = "md",
  className = "",
  frame = "standard",
  useBatchSignedUrls = false,
}: EmployeePhotoAvatarProps) {
  const isOnline = useOnlineStatus();
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const batchSignedUrl = useBatchSignedUrl(
    useBatchSignedUrls ? employeeId : undefined,
  );
  const sizeClass = sizeClasses[size];
  const shapeClass =
    frame === "passport" ? "rounded-sm" : EMPLOYEE_AVATAR_CORNER_CLASS;
  const initials = getInitialsFromName(fullName);

  useEffect(() => {
    let cancelled = false;
    setImageFailed(false);

    const trimmed = photoUrl?.trim() ?? "";
    if (!trimmed) {
      setResolvedSrc(null);
      return;
    }

    if (!isEmployeePhotoStorageReference(trimmed)) {
      setResolvedSrc(trimmed);
      return;
    }

    if (useBatchSignedUrls) {
      setResolvedSrc(null);
      return;
    }

    const id = employeeId?.trim();
    if (!id) {
      setResolvedSrc(null);
      return;
    }

    setResolvedSrc(null);

    fetch(employeePhotoSignedUrlEndpoint(id))
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }
        const payload = (await response.json()) as { signedUrl?: string };
        return payload.signedUrl?.trim() || null;
      })
      .then((signedUrl) => {
        if (!cancelled) {
          setResolvedSrc(signedUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedSrc(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [photoUrl, employeeId, useBatchSignedUrls]);

  const storageResolvedSrc = useBatchSignedUrls ? batchSignedUrl : resolvedSrc;
  const displaySrc = offlineAvatarSrc(isOnline, storageResolvedSrc);

  const wrapperClass = `${sizeClass} ${shapeClass} shrink-0 overflow-hidden ${className}`;

  if (displaySrc?.trim() && !imageFailed) {
    return (
      <div className={wrapperClass}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displaySrc}
          alt={fullName ? `${fullName} photo` : "Employee photo"}
          className={`h-full w-full ${shapeClass} object-cover bg-slate-100`}
          onError={() => setImageFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={`${wrapperClass} flex items-center justify-center bg-[#0f2744] text-white`}
      aria-hidden={!fullName}
      title={fullName ?? undefined}
    >
      {initials ? (
        <span className="font-semibold">{initials}</span>
      ) : (
        <PersonSilhouetteIcon className="h-[55%] w-[55%] text-white/90" />
      )}
    </div>
  );
}
