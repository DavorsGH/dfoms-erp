import Image from "next/image";
import {
  DEFAULT_WORKSPACE_LOGO,
  DEFAULT_WORKSPACE_NAME,
} from "@/utils/tenant-branding-types";

type PortalHeaderBrandProps = {
  variant?: "dark" | "light";
};

/**
 * Shared left-side branding for Tenant and Landlord portal top bars.
 */
export default function PortalHeaderBrand({
  variant = "dark",
}: PortalHeaderBrandProps) {
  const isDark = variant === "dark";

  return (
    <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
      <Image
        src={DEFAULT_WORKSPACE_LOGO}
        alt={`${DEFAULT_WORKSPACE_NAME} logo`}
        width={44}
        height={44}
        className="h-10 w-10 shrink-0 rounded-sm object-cover sm:h-11 sm:w-11"
        priority
      />
      <div className="min-w-0">
        <p
          className={`truncate text-base font-semibold leading-tight sm:text-lg ${
            isDark ? "text-emerald-400" : "text-[#0f2744]"
          }`}
        >
          {DEFAULT_WORKSPACE_NAME}
        </p>
        <p
          className={`truncate text-sm font-medium leading-tight ${
            isDark ? "text-white/90" : "text-slate-600"
          }`}
        >
          Real Estate Portal
        </p>
      </div>
    </div>
  );
}

export const portalPageGreetingClassName =
  "text-xl font-semibold text-[#0f2744]";
