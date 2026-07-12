import LogoutButton from "./logout-button";

type TopBarProps = {
  userLabel: string;
};

export default function TopBar({ userLabel }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-700">{userLabel}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
