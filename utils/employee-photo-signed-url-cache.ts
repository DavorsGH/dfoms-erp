"use client";

import { isEmployeePhotoStorageReference } from "@/utils/employee-photo";

const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
const BATCH_MAX = 200;

type CacheEntry = {
  url: string;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
const pendingIds = new Set<string>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function cacheKey(employeeId: string): string {
  return employeeId.trim();
}

function isCacheEntryFresh(entry: CacheEntry): boolean {
  return entry.expiresAt - REFRESH_BEFORE_EXPIRY_MS > Date.now();
}

export function getCachedEmployeePhotoSignedUrl(
  employeeId: string | undefined,
): string | null {
  const key = employeeId?.trim();
  if (!key) {
    return null;
  }
  const entry = cache.get(key);
  if (!entry || !isCacheEntryFresh(entry)) {
    return null;
  }
  return entry.url;
}

export function subscribeEmployeePhotoSignedUrlCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function flushBatch(): Promise<void> {
  const ids = [...pendingIds];
  pendingIds.clear();

  if (ids.length === 0) {
    return;
  }

  const missing = ids.filter((id) => {
    const entry = cache.get(id);
    return !entry || !isCacheEntryFresh(entry);
  });

  if (missing.length === 0) {
    return;
  }

  try {
    const expiresAt = Date.now() + 3600 * 1000;

    for (let offset = 0; offset < missing.length; offset += BATCH_MAX) {
      const chunk = missing.slice(offset, offset + BATCH_MAX);
      const response = await fetch("/api/storage/employee-photos/signed-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_ids: chunk }),
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as Record<string, string>;
      for (const [employeeId, url] of Object.entries(payload)) {
        const trimmedUrl = url?.trim();
        if (trimmedUrl) {
          cache.set(cacheKey(employeeId), { url: trimmedUrl, expiresAt });
        }
      }
    }
    notifyListeners();
  } catch {
    // ignore; avatars fall back to initials
  }
}

export function prefetchEmployeePhotoSignedUrls(
  employeeIds: string[],
  photoUrlByEmployeeId?: ReadonlyMap<string, string | null | undefined>,
): void {
  for (const rawId of employeeIds) {
    const id = rawId.trim();
    if (!id) {
      continue;
    }
    if (photoUrlByEmployeeId) {
      const photoUrl = photoUrlByEmployeeId.get(id);
      if (!photoUrl?.trim() || !isEmployeePhotoStorageReference(photoUrl)) {
        continue;
      }
    }
    const entry = cache.get(id);
    if (entry && isCacheEntryFresh(entry)) {
      continue;
    }
    pendingIds.add(id);
  }

  if (pendingIds.size === 0) {
    return;
  }

  if (!inFlight) {
    inFlight = flushBatch().finally(() => {
      inFlight = null;
      if (pendingIds.size > 0) {
        prefetchEmployeePhotoSignedUrls([]);
      }
    });
  }
}
