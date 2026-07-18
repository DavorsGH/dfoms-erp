import InventoryNav from "./inventory-nav";

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
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Inventory
      </h1>
      <InventoryNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
