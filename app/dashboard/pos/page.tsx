import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import { canAccessCrmSection } from "@/utils/rbac-access";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { CLIENT_SELECT, type ClientEntry } from "../operations/clients-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../inventory/finished-products-utils";
import CrmShell from "../crm/crm-shell";
import PosCheckout from "./pos-checkout";

export default async function PosPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const role = (await getCurrentUserRole()) as AppRole | null;
  const showCrmNav = canAccessCrmSection(role);

  const [
    { data: clients, error: clientsError },
    { data: products, error: productsError },
    { data: paymentMethods, error: paymentMethodsError },
  ] = await Promise.all([
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", {
      ascending: true,
    }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .order("product_name", { ascending: true }),
    supabase.from("payment_methods").select("name").order("name", {
      ascending: true,
    }),
  ]);

  const fetchError =
    clientsError?.message ??
    productsError?.message ??
    paymentMethodsError?.message ??
    null;

  const checkout = (
    <PosCheckout
      showTitle={!showCrmNav}
      initialClients={(clients as ClientEntry[] | null) ?? []}
      initialProducts={
        ((products as FinishedProductRecord[] | null) ?? []).map((row) =>
          normalizeFinishedProduct(row),
        )
      }
      initialPaymentMethods={
        ((paymentMethods as { name: string }[] | null) ?? []).map(
          (row) => row.name,
        )
      }
      fetchError={fetchError}
    />
  );

  if (!showCrmNav) {
    return checkout;
  }

  return <CrmShell sectionTitle="POS">{checkout}</CrmShell>;
}
