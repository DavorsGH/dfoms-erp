import Link from "next/link";
import LogoutButton from "./logout-button";

type TopBarProps = {
  userLabel: string;
};

export default function TopBar({ userLabel }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/my-account"
          className="text-sm text-slate-700 transition-colors hover:text-[#0f2744] hover:underline"
        >
          {userLabel}
        </Link>
        <LogoutButton />
      </div>
    </header>
  );
}
