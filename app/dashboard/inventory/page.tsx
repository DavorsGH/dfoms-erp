import { redirect } from "next/navigation";
import { INVENTORY_FINISHED_PRODUCTS_HREF } from "./inventory-nav-config";

export default function InventoryPage() {
  redirect(INVENTORY_FINISHED_PRODUCTS_HREF);
}
