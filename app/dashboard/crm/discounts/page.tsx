import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  DISCOUNT_RULE_LIST_SELECT,
  normalizeDiscountRuleRow,
  type DiscountRuleListRow,
} from "@/utils/discount-rules-types";
import CrmShell from "../crm-shell";
import DiscountsList from "./discounts-list";

export default async function DiscountsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("discount_rules")
    .select(DISCOUNT_RULE_LIST_SELECT)
    .order("code", { ascending: true });

  return (
    <CrmShell sectionTitle="Discounts">
      <DiscountsList
        initialRules={
          ((data as DiscountRuleListRow[] | null) ?? []).map(normalizeDiscountRuleRow)
        }
        fetchError={error?.message ?? null}
      />
    </CrmShell>
  );
}
