export type InventoryNavItem = {
  label: string;
  href: string;
};

export type InventoryNavGroup = {
  id: string;
  label: string;
  items: readonly InventoryNavItem[];
};

export const INVENTORY_FINISHED_PRODUCTS_HREF =
  "/dashboard/inventory/finished-products";

export const INVENTORY_GROUPS: readonly InventoryNavGroup[] = [
  {
    id: "finished-products",
    label: "Finished Products",
    items: [
      { label: "Finished Products", href: INVENTORY_FINISHED_PRODUCTS_HREF },
    ],
  },
  {
    id: "production",
    label: "Production",
    items: [
      { label: "Raw Materials", href: "/dashboard/inventory/raw-materials" },
      {
        label: "Production Batches",
        href: "/dashboard/inventory/production-batches",
      },
      {
        label: "Internal Consumption",
        href: "/dashboard/inventory/internal-consumption",
      },
    ],
  },
  {
    id: "purchasing",
    label: "Purchasing",
    items: [
      { label: "Suppliers", href: "/dashboard/inventory/suppliers" },
      {
        label: "Purchase Orders",
        href: "/dashboard/inventory/purchase-orders",
      },
      { label: "Purchases", href: "/dashboard/inventory/product-purchases" },
    ],
  },
] as const;

export function isInventoryPath(pathname: string): boolean {
  return pathname.startsWith("/dashboard/inventory");
}

export function isInventoryItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getActiveInventoryGroup(
  pathname: string,
): InventoryNavGroup | null {
  for (const group of INVENTORY_GROUPS) {
    if (group.items.some((item) => isInventoryItemActive(pathname, item.href))) {
      return group;
    }
  }

  return null;
}

export function getInventoryGroupDefaultHref(
  group: InventoryNavGroup,
): string {
  return group.items[0]?.href ?? INVENTORY_FINISHED_PRODUCTS_HREF;
}

export const INVENTORY_SIDEBAR_LINKS = INVENTORY_GROUPS.map((group) => ({
  label: group.label,
  href: getInventoryGroupDefaultHref(group),
  groupId: group.id,
}));

export function isInventoryGroupActive(
  pathname: string,
  groupId: string,
): boolean {
  const group = INVENTORY_GROUPS.find((entry) => entry.id === groupId);
  if (!group) {
    return false;
  }

  return group.items.some((item) => isInventoryItemActive(pathname, item.href));
}
