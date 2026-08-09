"use client";

import { TenantLogosMediaImage } from "@/components/tenant-logos-media";

type FinishedProductPhotoProps = {
  photoUrl?: string | null;
  productName?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
};

const sizeClasses = {
  xs: "h-8 w-8",
  sm: "h-10 w-10",
  md: "h-12 w-12",
  lg: "h-16 w-16",
} as const;

function ProductPlaceholderIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    </svg>
  );
}

export default function FinishedProductPhoto({
  photoUrl,
  productName,
  size = "sm",
  className = "",
}: FinishedProductPhotoProps) {
  const sizeClass = sizeClasses[size];
  const label = productName?.trim() || "Product";

  if (photoUrl?.trim()) {
    return (
      <TenantLogosMediaImage
        reference={photoUrl}
        alt={`${label} photo`}
        className={`${sizeClass} shrink-0 rounded-md object-cover bg-slate-100 ring-1 ring-slate-200 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400 ring-1 ring-slate-200 ${className}`}
      title={`${label} — no photo`}
      aria-hidden
    >
      <ProductPlaceholderIcon className="h-[55%] w-[55%]" />
    </div>
  );
}
