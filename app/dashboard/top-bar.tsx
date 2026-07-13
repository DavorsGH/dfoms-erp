import Link from "next/link";
import EmployeePhotoAvatar from "./employee-photo-avatar";
import LogoutButton from "./logout-button";

type TopBarProps = {
  userLabel: string;
  userPhotoUrl?: string | null;
  userFullName?: string | null;
};

export default function TopBar({
  userLabel,
  userPhotoUrl,
  userFullName,
}: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/my-account"
          className="flex items-center gap-2.5 text-sm text-slate-700 transition-colors hover:text-[#0f2744] hover:underline"
        >
          <EmployeePhotoAvatar
            photoUrl={userPhotoUrl}
            fullName={userFullName ?? userLabel}
            size="xs"
          />
          <span>{userLabel}</span>
        </Link>
        <LogoutButton />
      </div>
    </header>
  );
}
