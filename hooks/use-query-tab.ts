"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Keeps a page tab in the query string so refresh, back, and a shared link
 * reopen the same tab. An unknown or disallowed value falls back to defaultTab.
 */
export function useQueryTab<T extends string>(options: {
  values: readonly T[];
  defaultTab: T;
  param?: string;
  isAllowed?: (tab: T) => boolean;
  fromUrl?: (value: string) => T | null;
  toUrl?: (tab: T) => string;
}): { tab: T; setTab: (next: T) => void } {
  const param = options.param ?? "tab";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get(param)?.trim() ?? "";
  const mapped = raw
    ? options.fromUrl
      ? options.fromUrl(raw)
      : options.values.includes(raw as T)
        ? (raw as T)
        : null
    : null;
  const allowed =
    mapped != null && (options.isAllowed ? options.isAllowed(mapped) : true);
  const tab = mapped != null && allowed ? mapped : options.defaultTab;

  function setTab(next: T) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(param, options.toUrl ? options.toUrl(next) : next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return { tab, setTab };
}
