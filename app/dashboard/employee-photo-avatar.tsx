import { getInitialsFromName } from "@/utils/employee-photo";

type EmployeePhotoAvatarProps = {
  photoUrl?: string | null;
  fullName?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "header";
  className?: string;
  square?: boolean;
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

export default function EmployeePhotoAvatar({
  photoUrl,
  fullName,
  size = "md",
  className = "",
  square = false,
}: EmployeePhotoAvatarProps) {
  const sizeClass = sizeClasses[size];
  const shapeClass = square ? "rounded-lg" : "rounded-full";
  const initials = getInitialsFromName(fullName);

  if (photoUrl?.trim()) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={fullName ? `${fullName} photo` : "Employee photo"}
        className={`${sizeClass} ${shapeClass} shrink-0 object-cover bg-slate-100 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} ${shapeClass} flex shrink-0 items-center justify-center bg-[#0f2744] text-white ${className}`}
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
