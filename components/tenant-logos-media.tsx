"use client";

import { useEffect, useState } from "react";

type TenantLogosMediaImageProps = {
  reference: string;
  alt: string;
  className?: string;
  tenantId?: string;
  linkable?: boolean;
};

function signedUrlEndpoint(reference: string, tenantId?: string): string {
  const params = new URLSearchParams({ reference });
  if (tenantId?.trim()) {
    params.set("tenant_id", tenantId.trim());
  }
  return `/api/storage/tenant-logos/signed-url?${params.toString()}`;
}

/**
 * Renders a tenant-logos image from a storage path or legacy URL reference.
 * Fetches a fresh signed URL on mount (1h TTL on server).
 */
export function TenantLogosMediaImage({
  reference,
  alt,
  className,
  tenantId,
  linkable = false,
}: TenantLogosMediaImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(signedUrlEndpoint(reference, tenantId))
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }
        const payload = (await response.json()) as { signedUrl?: string };
        return payload.signedUrl?.trim() || null;
      })
      .then((signedUrl) => {
        if (!cancelled) {
          setSrc(signedUrl);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSrc(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reference, tenantId]);

  if (loading) {
    return (
      <div
        className={`animate-pulse bg-slate-100 ${className ?? ""}`.trim()}
        aria-hidden
      />
    );
  }

  if (!src) {
    return null;
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} />
  );

  if (linkable) {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block">
        {image}
      </a>
    );
  }

  return image;
}

type TenantLogosMediaLinkProps = {
  reference: string;
  tenantId?: string;
  children: React.ReactNode;
  className?: string;
};

/** Anchor that opens a signed URL for documents/receipts (PDF, etc.). */
export function TenantLogosMediaLink({
  reference,
  tenantId,
  children,
  className,
}: TenantLogosMediaLinkProps) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(signedUrlEndpoint(reference, tenantId))
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }
        const payload = (await response.json()) as { signedUrl?: string };
        return payload.signedUrl?.trim() || null;
      })
      .then((signedUrl) => {
        if (!cancelled) {
          setHref(signedUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHref(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reference, tenantId]);

  if (!href) {
    return <span className={className}>{children}</span>;
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}
