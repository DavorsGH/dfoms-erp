"use client";

import { useEffect, useState } from "react";
import { LoadingState } from "@/components/loading-indicator";
import { createClient } from "@/utils/supabase/client";
import {
  DISCOUNT_RULE_FORM_SELECT,
  discountRuleToFormState,
  normalizeDiscountRuleRow,
  type DiscountRuleFormState,
  type DiscountRuleListRow,
} from "@/utils/discount-rules-types";
import DiscountRuleForm from "./discount-rule-form";

type DiscountRuleEditProps = {
  ruleId: string;
};

export default function DiscountRuleEdit({ ruleId }: DiscountRuleEditProps) {
  const [initialForm, setInitialForm] = useState<DiscountRuleFormState | null>(
    null,
  );
  const [usageCount, setUsageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function loadDiscountRule() {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("discount_rules")
        .select(DISCOUNT_RULE_FORM_SELECT)
        .eq("id", ruleId)
        .maybeSingle();

      if (cancelled) {
        return;
      }

      if (fetchError) {
        setError(fetchError.message);
        setInitialForm(null);
        setLoading(false);
        return;
      }

      if (!data) {
        setError("Discount rule not found.");
        setInitialForm(null);
        setLoading(false);
        return;
      }

      const rule = normalizeDiscountRuleRow(data as DiscountRuleListRow);
      setInitialForm(discountRuleToFormState(rule));
      setUsageCount(rule.usage_count);
      setLoading(false);
    }

    void loadDiscountRule();

    return () => {
      cancelled = true;
    };
  }, [ruleId]);

  if (loading) {
    return <LoadingState label="Loading discount rule…" />;
  }

  if (error || !initialForm) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error ?? "Discount rule not found."}
      </p>
    );
  }

  return (
    <DiscountRuleForm
      key={ruleId}
      mode="edit"
      ruleId={ruleId}
      initialForm={initialForm}
      usageCount={usageCount}
    />
  );
}
