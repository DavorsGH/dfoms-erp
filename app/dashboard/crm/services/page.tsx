import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import CrmShell from "../crm-shell";
import ServiceCatalogList from "./service-catalog-list";
import {
  SERVICE_CATALOG_SELECT,
  normalizeServiceCatalogEntry,
  type ServiceCatalogEntry,
} from "./service-catalog-utils";

export default async function ServicesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("service_catalog")
    .select(SERVICE_CATALOG_SELECT)
    .order("service_name", { ascending: true });

  return (
    <CrmShell sectionTitle="Services">
      <ServiceCatalogList
        initialServices={
          ((data as ServiceCatalogEntry[] | null) ?? []).map(
            normalizeServiceCatalogEntry,
          )
        }
        fetchError={error?.message ?? null}
      />
    </CrmShell>
  );
}
