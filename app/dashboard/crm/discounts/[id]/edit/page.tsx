import Link from "next/link";
import CrmShell from "../../../crm-shell";
import DiscountRuleEdit from "../../discount-rule-edit";

type EditDiscountRulePageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditDiscountRulePage({
  params,
}: EditDiscountRulePageProps) {
  const { id } = await params;

  return (
    <CrmShell sectionTitle="Discounts">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-[#0f2744]">Edit Discount Rule</h3>
        <Link
          href="/dashboard/crm/discounts"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <DiscountRuleEdit ruleId={id} />
    </CrmShell>
  );
}
