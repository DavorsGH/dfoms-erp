import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import CrmShell from "../crm-shell";
import OfflineSaleConflictsPanel, {
  type OfflineSaleConflictRow,
} from "./offline-sale-conflicts-panel";

export default async function OfflineSaleConflictsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("offline_sale_conflicts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <CrmShell sectionTitle="Offline sale conflicts">
      <OfflineSaleConflictsPanel
        initialConflicts={(data as OfflineSaleConflictRow[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </CrmShell>
  );
}
