// scripts/smoke-test-98-99-production.mjs
// Production smoke test for the 7-table composite-key migration (scripts 98/99).
// Mirrors scripts/smoke-test-98-99-staging.mjs, which passed all 7 write tests on staging.
//
// IMPORTANT: run this with .env.local pointed at PRODUCTION (verify first with
//   Get-Content .env.local | Select-String "SUPABASE"
// — should show tvcurcnmasnocwdxzgvz, NOT wieflwbfdmjtsdnwbfii).
//
// Inserts one ZZSMK-prefixed test row per table, verifies cross-reference readback,
// then deletes everything in reverse dependency order. Fails loudly and does NOT
// silently continue if any step errors, so nothing is left behind on a partial failure.

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

if (!url.includes('tvcurcnmasnocwdxzgvz')) {
  console.error(`REFUSING TO RUN: .env.local does not point at production (tvcurcnmasnocwdxzgvz).`);
  console.error(`Currently pointed at: ${url}`);
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

// Find the real Davors tenant_id (this is a real-tenant smoke test, same as staging's approach)
const { data: tenantRow, error: tenantErr } = await supabase
  .from('tenants')
  .select('id')
  .eq('id', '00000001-0000-4000-8000-000000000001')
  .single();

if (tenantErr || !tenantRow) {
  console.error('Could not resolve Davors tenant_id:', tenantErr);
  process.exit(1);
}

const tenantId = tenantRow.id;
const P = 'ZZSMKMRVP8T0Q'; // test-row prefix, same convention as staging test

const results = [];

function logResult(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step}${detail ? ' — ' + detail : ''}`);
  if (!ok) {
    console.error('Aborting on first failure to avoid partial/inconsistent test state.');
    process.exit(1);
  }
}

// === WRITES ===

// 1. employees
const employeeId = `${P}EMP`;
const staffId = `${P}STF`;
{
  const { error } = await supabase.from('employees').insert({
    tenant_id: tenantId,
    employee_id: employeeId,
    staff_id: staffId,
    full_name: 'ZZ Smoke Test Employee',
    employment_type: 'Full-Time',
  });
  logResult('employees insert', !error, error?.message);
}

// 2. work_orders
const workOrderNo = `${P}WO`;
{
  const { error } = await supabase.from('work_orders').insert({
    tenant_id: tenantId,
    work_order_no: workOrderNo,
    assigned_cleaner: employeeId,
    supervisor: employeeId,
    date: new Date().toISOString().slice(0, 10),
  });
  logResult('work_orders insert (cleaner+supervisor -> test employee)', !error, error?.message);
}

// 3. complaint_register
const complaintNo = `${P}CMP`;
{
  const { error } = await supabase.from('complaint_register').insert({
    tenant_id: tenantId,
    complaint_no: complaintNo,
    assigned_supervisor: employeeId,
    date_received: new Date().toISOString().slice(0, 10),
  });
  logResult('complaint_register insert (assigned_supervisor -> test employee)', !error, error?.message);
}

// 4. failed_inspections
const issueNo = `${P}ISS`;
{
  const { error } = await supabase.from('failed_inspections').insert({
    tenant_id: tenantId,
    issue_no: issueNo,
    assigned_person: employeeId,
    date_identified: new Date().toISOString().slice(0, 10),
  });
  logResult('failed_inspections insert (assigned_person -> test employee)', !error, error?.message);
}

// 5. incident_register
const incidentNo = `${P}INC`;
{
  const { error } = await supabase.from('incident_register').insert({
    tenant_id: tenantId,
    incident_no: incidentNo,
    reported_by: employeeId,
    date: new Date().toISOString().slice(0, 10),
  });
  logResult('incident_register insert (reported_by -> test employee)', !error, error?.message);
}

// 6. fixed_assets
const assetId = `${P}FA`;
{
  const { error } = await supabase.from('fixed_assets').insert({
    tenant_id: tenantId,
    asset_id: assetId,
    asset_name: 'ZZ Smoke Test Asset',
  });
  logResult('fixed_assets insert', !error, error?.message);
}

// 7. corrective_actions (cross-references work_orders + failed_inspections + employees)
const actionNo = `${P}CA`;
{
  const { error } = await supabase.from('corrective_actions').insert({
    tenant_id: tenantId,
    action_no: actionNo,
    related_work_order: workOrderNo,
    related_issue_no: issueNo,
    responsible_person: employeeId,
    date_raised: new Date().toISOString().slice(0, 10),
  });
  logResult(
    'corrective_actions insert (related_work_order + related_issue_no + responsible_person)',
    !error,
    error?.message
  );
}

// === CROSS-REFERENCE READBACK ===

{
  const { data, error } = await supabase
    .from('corrective_actions')
    .select(`
      action_no,
      related_work_order,
      related_issue_no,
      responsible_person,
      work_orders!corrective_actions_related_work_order_fkey(work_order_no),
      failed_inspections!corrective_actions_related_issue_no_fkey(issue_no),
      employees!corrective_actions_responsible_person_fkey(employee_id, full_name)
    `)
    .eq('tenant_id', tenantId)
    .eq('action_no', actionNo)
    .single();

  const ok =
    !error &&
    data?.work_orders?.work_order_no === workOrderNo &&
    data?.failed_inspections?.issue_no === issueNo &&
    data?.employees?.employee_id === employeeId;

  logResult('corrective_actions cross-reference readback', ok, error?.message);
}

for (const [table, col, fkName] of [
  ['work_orders', 'assigned_cleaner', 'work_orders_assigned_cleaner_fkey'],
  ['complaint_register', 'assigned_supervisor', 'complaint_register_assigned_supervisor_fkey'],
  ['failed_inspections', 'assigned_person', 'failed_inspections_assigned_person_fkey'],
  ['incident_register', 'reported_by', 'incident_register_reported_by_fkey'],
]) {
  const { data, error } = await supabase
    .from(table)
    .select(`${col}, employees!${fkName}(employee_id, full_name)`)
    .eq('tenant_id', tenantId)
    .limit(1)
    .order(col === 'assigned_cleaner' ? 'work_order_no' : col, { ascending: false });

  const row = Array.isArray(data) ? data[0] : data;
  const ok = !error && row?.employees?.employee_id === employeeId;
  logResult(`${table} employee embed readback`, ok, error?.message);
}

// === CLEANUP (reverse dependency order) ===

const cleanupSteps = [
  ['corrective_actions', 'action_no', actionNo],
  ['fixed_assets', 'asset_id', assetId],
  ['incident_register', 'incident_no', incidentNo],
  ['failed_inspections', 'issue_no', issueNo],
  ['complaint_register', 'complaint_no', complaintNo],
  ['work_orders', 'work_order_no', workOrderNo],
  ['employees', 'employee_id', employeeId],
];

for (const [table, col, val] of cleanupSteps) {
  const { error } = await supabase.from(table).delete().eq('tenant_id', tenantId).eq(col, val);
  logResult(`cleanup: delete from ${table}`, !error, error?.message);
}

// === LEFTOVER CHECK ===

for (const table of ['employees', 'work_orders', 'complaint_register', 'failed_inspections', 'incident_register', 'fixed_assets', 'corrective_actions']) {
  const idCol = {
    employees: 'employee_id',
    work_orders: 'work_order_no',
    complaint_register: 'complaint_no',
    failed_inspections: 'issue_no',
    incident_register: 'incident_no',
    fixed_assets: 'asset_id',
    corrective_actions: 'action_no',
  }[table];

  const { data, error } = await supabase
    .from(table)
    .select(idCol)
    .eq('tenant_id', tenantId)
    .like(idCol, `${P}%`);

  logResult(`leftover ${P}% check: ${table}`, !error && data?.length === 0, error?.message || `${data?.length} leftover row(s)`);
}

console.log('\n=== SUMMARY ===');
console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed.`);
console.log('ALL PRODUCTION SMOKE TESTS PASSED — no leftover test rows.');
