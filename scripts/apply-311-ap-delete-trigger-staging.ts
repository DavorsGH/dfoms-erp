import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION public.trg_pur_accounts_payable_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._pur_delete_ap_accrual_expense(OLD.tenant_id, OLD.id);
  PERFORM public._pur_delete_tax_ledger_for_source('accounts_payable', OLD.id::text);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_payable_pur_before_delete ON public.accounts_payable;
CREATE TRIGGER trg_accounts_payable_pur_before_delete
  BEFORE DELETE ON public.accounts_payable
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_pur_accounts_payable_before_delete();
`;

async function main() {
  const { client, envFile } = await connectPg({
    envFiles: [".env.staging.local"],
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
  });
  console.log(`Connected via ${envFile}`);
  await client.query(TRIGGER_SQL);
  const { rows } = await client.query(`
    SELECT tgname, pg_get_triggerdef(oid) AS def
    FROM pg_trigger
    WHERE tgname = 'trg_accounts_payable_pur_before_delete'
  `);
  console.log("Trigger applied:", rows[0]?.tgname ?? "(missing)");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
