import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function main() {
  const receiptNo = process.argv[2] ?? "PAYROLL-SAL-2026-07";
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase credentials in .env.local");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: before, error: beforeError } = await admin
    .from("expense_register")
    .select("id, receipt_no, expense_category, payment_status, amount")
    .eq("receipt_no", receiptNo)
    .maybeSingle();

  if (beforeError) {
    throw new Error(beforeError.message);
  }

  if (!before) {
    console.log(`No expense_register row found for receipt_no ${receiptNo}`);
    return;
  }

  console.log("Before:", before);

  const { data: after, error: updateError } = await admin
    .from("expense_register")
    .update({
      expense_category: "Staff Salaries",
      payment_status: "Accrued - Not Yet Paid",
      payment_method: "Accrual",
      sub_category: "Payroll",
    })
    .eq("id", before.id)
    .select("id, receipt_no, expense_category, payment_status, amount")
    .single();

  if (updateError) {
    throw new Error(updateError.message);
  }

  console.log("After:", after);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
