import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SUPPLIER_CONTRACT_ENTITY_TYPE,
  SUPPLIER_CONTRACT_HEADER_SELECT,
  normalizeSupplierContractStatus,
  roundMoney,
  toNumber,
  type SupplierContractAmendmentWriteBody,
  type SupplierContractWriteBody,
} from "@/utils/supplier-contracts-types";

type DbClient = SupabaseClient;

function nullableText(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

export async function allocateSupplierContractNumber(
  supabase: DbClient,
  tenantId: string,
) {
  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: SUPPLIER_CONTRACT_ENTITY_TYPE,
    p_padding: 4,
  });
  if (error) {
    return { contractNumber: null, error: error.message };
  }
  const contractNumber = typeof data === "string" ? data.trim() : "";
  if (!contractNumber) {
    return { contractNumber: null, error: "Empty contract number from generate_next_code." };
  }
  return { contractNumber, error: null };
}

async function nextContractSequence(supabase: DbClient, tenantId: string) {
  const { data } = await supabase
    .from("supplier_contracts")
    .select("contract_sequence")
    .eq("tenant_id", tenantId)
    .order("contract_sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  return toNumber(data?.contract_sequence ?? 0) + 1;
}

export async function createSupplierContract(
  supabase: DbClient,
  tenantId: string,
  body: SupplierContractWriteBody,
  createdBy: string | null,
  businessUnitId: string | null,
) {
  const { data: supplier, error: supplierError } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("id", body.supplier_id)
    .maybeSingle();
  if (supplierError || !supplier) {
    return { contract: null, error: supplierError?.message ?? "Supplier not found." };
  }

  const { contractNumber, error: numberError } = await allocateSupplierContractNumber(
    supabase,
    tenantId,
  );
  if (numberError || !contractNumber) {
    return { contract: null, error: numberError ?? "Unable to allocate contract number." };
  }

  const sequence = await nextContractSequence(supabase, tenantId);
  const status = normalizeSupplierContractStatus(body.status);
  const nextBilling =
    nullableText(body.next_billing_date ?? null) ??
    (status === "active" ? body.start_date : null);

  const { data: contract, error: insertError } = await supabase
    .from("supplier_contracts")
    .insert({
      tenant_id: tenantId,
      business_unit_id: businessUnitId,
      supplier_id: body.supplier_id,
      supplier_name: supplier.name,
      contract_number: contractNumber,
      contract_sequence: sequence,
      agreement_type: body.agreement_type,
      document_url: nullableText(body.document_url ?? null),
      start_date: body.start_date,
      end_date: body.end_date,
      auto_renew: body.auto_renew ?? false,
      status,
      expense_category: body.expense_category.trim(),
      sub_category: body.sub_category.trim(),
      wht_rate: roundMoney(toNumber(body.wht_rate ?? 0)),
      next_billing_date: nextBilling,
      mid_month_reminder_enabled: body.mid_month_reminder_enabled ?? false,
      mid_month_reminder_day: body.mid_month_reminder_day ?? 15,
      credit_balance: 0,
      notes: nullableText(body.notes ?? null),
    })
    .select(SUPPLIER_CONTRACT_HEADER_SELECT)
    .single();

  if (insertError || !contract) {
    return { contract: null, error: insertError?.message ?? "Insert failed." };
  }

  const { error: amendmentError } = await supabase
    .from("supplier_contract_amendments")
    .insert({
      tenant_id: tenantId,
      contract_id: contract.id,
      effective_date: body.start_date,
      previous_monthly_amount: null,
      new_monthly_amount: roundMoney(toNumber(body.initial_monthly_amount)),
      change_reason: "Initial agreement",
      document_url: nullableText(body.document_url ?? null),
      created_by: createdBy,
    });

  if (amendmentError) {
    return { contract: null, error: amendmentError.message };
  }

  return { contract, error: null };
}

export async function addSupplierContractAmendment(
  supabase: DbClient,
  tenantId: string,
  contractId: string,
  body: SupplierContractAmendmentWriteBody,
  createdBy: string | null,
) {
  const { data: contract, error: contractError } = await supabase
    .from("supplier_contracts")
    .select("id, tenant_id")
    .eq("id", contractId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (contractError || !contract) {
    return { error: contractError?.message ?? "Contract not found." };
  }

  const { data: prior } = await supabase
    .from("supplier_contract_amendments")
    .select("new_monthly_amount")
    .eq("contract_id", contractId)
    .eq("tenant_id", tenantId)
    .lte("effective_date", body.effective_date)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: amendment, error } = await supabase
    .from("supplier_contract_amendments")
    .insert({
      tenant_id: tenantId,
      contract_id: contractId,
      effective_date: body.effective_date,
      previous_monthly_amount:
        prior?.new_monthly_amount != null
          ? roundMoney(toNumber(prior.new_monthly_amount))
          : null,
      new_monthly_amount: roundMoney(toNumber(body.new_monthly_amount)),
      change_reason: body.change_reason.trim(),
      document_url: nullableText(body.document_url ?? null),
      created_by: createdBy,
    })
    .select("id")
    .single();

  return {
    amendmentId: amendment?.id ?? null,
    error: error?.message ?? null,
  };
}

export async function terminateSupplierContract(
  supabase: DbClient,
  tenantId: string,
  contractId: string,
) {
  const { data: row, error: fetchError } = await supabase
    .from("supplier_contracts")
    .select("notes, credit_balance")
    .eq("id", contractId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (fetchError) {
    return { error: fetchError.message };
  }
  if (!row) {
    return { error: "Contract not found." };
  }

  const credit = Number(row.credit_balance ?? 0);
  const terminatedAt = new Date().toISOString().slice(0, 10);
  const creditNote =
    credit > 0
      ? ` Terminated ${terminatedAt}: supplier owes GHS ${credit.toFixed(2)} of unused credit (credit_balance).`
      : ` Terminated ${terminatedAt}.`;
  const priorNotes = typeof row.notes === "string" ? row.notes.trim() : "";
  const notes = priorNotes ? `${priorNotes}${creditNote}` : creditNote.trim();

  const { error } = await supabase
    .from("supplier_contracts")
    .update({
      status: "terminated",
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contractId)
    .eq("tenant_id", tenantId);
  return { error: error?.message ?? null };
}
