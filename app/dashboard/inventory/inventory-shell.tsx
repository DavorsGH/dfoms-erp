import Link from "next/link";
import InventoryNav from "./inventory-nav";

const sectionActionLinkClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

type InventoryShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
};

export default function InventoryShell({
  children,
  sectionTitle,
}: InventoryShellProps) {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#0f2744]">Inventory</h1>
        <Link href="/dashboard/bulk-import?type=product" className={sectionActionLinkClassName}>
          Bulk Import
        </Link>
      </div>
      <InventoryNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
