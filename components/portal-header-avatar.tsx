import EmployeePhotoAvatar from "@/app/dashboard/employee-photo-avatar";
import { DEFAULT_WORKSPACE_LOGO } from "@/utils/tenant-branding-types";

type PortalHeaderAvatarProps = {
  photoUrl?: string | null;
  fullName?: string | null;
  /** When set, shown instead of initials when photoUrl is empty (landlord header). */
  placeholderLogoUrl?: string | null;
  className?: string;
};

const headerSizeClass = "h-14 w-14 shrink-0";
const shapeClass = "rounded-lg";

/**
 * Square header avatar for Tenant and Landlord portals (staff ERP header style).
 */
export default function PortalHeaderAvatar({
  photoUrl,
  fullName,
  placeholderLogoUrl,
  className = "",
}: PortalHeaderAvatarProps) {
  const trimmed = photoUrl?.trim();
  if (trimmed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={trimmed}
        alt={fullName ? `${fullName} photo` : "Profile photo"}
        className={`${headerSizeClass} ${shapeClass} object-cover bg-slate-100 ${className}`}
      />
    );
  }

  if (placeholderLogoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={placeholderLogoUrl}
        alt="Davors Facilities"
        className={`${headerSizeClass} ${shapeClass} object-cover bg-white ${className}`}
      />
    );
  }

  return (
    <EmployeePhotoAvatar
      photoUrl={null}
      fullName={fullName}
      size="header"
      square
      className={className}
    />
  );
}

export { DEFAULT_WORKSPACE_LOGO as LANDLORD_HEADER_PLACEHOLDER_LOGO };
