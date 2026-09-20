import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(resolve(process.cwd(), '.env.staging.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  const key = t.slice(0, i).trim();
  let val = t.slice(i + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  process.env[key] = val;
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const DAVORS = '00000001-0000-4000-8000-000000000001';

async function main() {
  const { data: p, error: pErr } = await admin
    .from('finished_products')
    .select('id,product_code,product_name,current_stock')
    .eq('tenant_id', DAVORS)
    .gt('current_stock', 0)
    .limit(1)
    .single();

  if (pErr || !p) {
    console.error('No product:', pErr);
    process.exit(1);
  }

  console.log('Product:', p.product_code, p.product_name, 'stock:', p.current_stock);

  const { error } = await admin.rpc('checkout_pos_cart', {
    p_tenant_id: DAVORS,
    p_business_unit_id: null,
    p_sale_date: '2026-09-06',
    p_invoice_no: null,
    p_client_id: null,
    p_customer_name: 'Error shape test',
    p_payment_status: 'Paid',
    p_due_date: '2026-09-06',
    p_notes: null,
    p_payment_method: 'Cash',
    p_sales_rep_id: null,
    p_amount_received: 100,
    p_lines: [
      { product_id: p.id, quantity: 1, unit_price: 10, product_code: p.product_code, product_name: p.product_name },
      { product_id: p.id, quantity: 99999, unit_price: 10, product_code: p.product_code, product_name: p.product_name },
    ],
    p_payment_request_id: null,
    p_paid_amount: null,
    p_paystack_reference: null,
    p_paid_at: null,
  });

  console.log('Supabase error object:', JSON.stringify(error, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
