import EmployeePhotoAvatar from "@/app/dashboard/employee-photo-avatar";
import { DEFAULT_WORKSPACE_LOGO } from "@/utils/tenant-branding-types";

export type PortalHeaderAvatarSize = "header" | "nav";

type PortalHeaderAvatarProps = {
  photoUrl?: string | null;
  fullName?: string | null;
  /** When set, shown instead of initials when photoUrl is empty (landlord header). */
  placeholderLogoUrl?: string | null;
  size?: PortalHeaderAvatarSize;
  className?: string;
};

const sizeClasses: Record<PortalHeaderAvatarSize, string> = {
  header: "h-14 w-14 text-sm",
  nav: "h-9 w-9 text-[10px]",
};

const employeeSizeMap: Record<PortalHeaderAvatarSize, "header" | "sm"> = {
  header: "header",
  nav: "sm",
};

const shapeClass = "rounded-lg";

/**
 * Square header avatar for Tenant and Landlord portals (staff ERP header style).
 */
export default function PortalHeaderAvatar({
  photoUrl,
  fullName,
  placeholderLogoUrl,
  size = "nav",
  className = "",
}: PortalHeaderAvatarProps) {
  const sizeClass = sizeClasses[size];
  const trimmed = photoUrl?.trim();

  if (trimmed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={trimmed}
        alt={fullName ? `${fullName} photo` : "Profile photo"}
        className={`${sizeClass} ${shapeClass} shrink-0 object-cover bg-slate-100 ${className}`}
      />
    );
  }

  if (placeholderLogoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={placeholderLogoUrl}
        alt="Davors Facilities"
        className={`${sizeClass} ${shapeClass} shrink-0 object-cover bg-white ${className}`}
      />
    );
  }

  return (
    <EmployeePhotoAvatar
      photoUrl={null}
      fullName={fullName}
      size={employeeSizeMap[size]}
      square
      className={className}
    />
  );
}

export { DEFAULT_WORKSPACE_LOGO as LANDLORD_HEADER_PLACEHOLDER_LOGO };
