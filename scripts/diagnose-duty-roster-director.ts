/**
 * Compare production duty-roster RPC function defs vs staging director/super_admin data.
 *
 * Usage: npx tsx scripts/diagnose-duty-roster-director.ts\n *\n * Production loads .env.vercel.production.local first; Postgres falls back to\n * .env.local.backup when Vercel env values are [SENSITIVE] placeholders.\n * Staging uses password sign-in when possible, else PG JWT simulation.
 */
import Module from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";
import { connectPg } from "./lib/pg-connect";
import {
  buildDutyRosterViewModel,
  normalizeDutyRosterEmployee,
  normalizeDutyRosterSite,
  type RosterHistoryRecord,
} from "../app/dashboard/operations/duty-roster-utils";
import { normalizeProjectEntry } from "../app/dashboard/administration/projects-utils";
import { getRosterConfigForClient, type RosterConfigRecord } from "../app/dashboard/operations/roster-config-utils";

function pgCount(rows: Array<{ count?: unknown }>): number {
  return Number(rows[0]?.count ?? 0);
}

const originalLoad = (
  Module as unknown as { _load: (...args: unknown[]) => unknown }
)._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load =
  function (request: unknown, parent: unknown, isMain: unknown) {
    if (request === "server-only") {
      return {};
    }
    return originalLoad(request, parent, isMain);
  };

const PRODUCTION_ENV = ".env.vercel.production.local";
const STAGING_ENV = ".env.staging.local";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TEST_PASSWORD = "TestRbac1!";
const SUPER_ADMIN_EMAIL = "rbac.admin@test.davors";
const CANDIDATE_CLIENT_IDS = ["CL-001", "CLI001"] as const;

const FUNCTION_NAMES = [
  "can_view_duty_roster_company_wide",
  "get_duty_roster_employee_display",
] as const;

type FunctionDefRow = {
  proname: string;
  oid: number;
  def: string;
};

type DirectorCandidate = {
  auth_uid: string;
  email: string | null;
  tenant_id: string | null;
  is_active: boolean | null;
  auth_email: string | null;
  auth_exists: boolean;
};

function projectRef(url: string): string {
  return url.match(/https:\/\/([^.]+)/)?.[1] ?? "(unknown)";
}

function directorMentionSummary(def: string) {
  return {
    mentions_director: /director/.test(def),
    includes_director_app_role: def.includes("'director'::app_role"),
  };
}

async function fetchFunctionDefs(
  pg: import("pg").Client,
  envLabel: string,
): Promise<Record<string, FunctionDefRow[]>> {
  const out: Record<string, FunctionDefRow[]> = {};
  for (const fn of FUNCTION_NAMES) {
    const { rows } = await pg.query(
      `SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = $1
       ORDER BY p.oid`,
      [fn],
    );
    out[`${envLabel}:${fn}`] = rows as FunctionDefRow[];
  }
  return out;
}

function printFunctionDefReport(
  label: string,
  grouped: Record<string, FunctionDefRow[]>,
) {
  console.log(`\n--- ${label} ---`);
  for (const fn of FUNCTION_NAMES) {
    const key = `${label}:${fn}`;
    const rows = grouped[key] ?? [];
    console.log(`Function: ${fn} (${rows.length} overload(s))`);
    if (rows.length === 0) {
      console.log("  MISSING");
      continue;
    }
    for (const row of rows) {
      console.log(`  oid=${row.oid} ${JSON.stringify(directorMentionSummary(row.def))}`);
      console.log(row.def);
      console.log("---");
    }
  }
}

async function runProductionSection() {
  const prodPath = resolve(process.cwd(), PRODUCTION_ENV);
  if (!existsSync(prodPath)) {
    throw new Error(`Missing ${PRODUCTION_ENV}`);
  }

  loadEnvForce(prodPath);

  console.log("=== PRODUCTION (DB only via pg_get_functiondef) ===");
  console.log("Env file:", PRODUCTION_ENV);

  const { client: pg, envFile, candidateIndex } = await connectPg({
    envFiles: [PRODUCTION_ENV, ".env.local.backup"],
    requiredProjectRef: PRODUCTION_REF,
  });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  console.log("Postgres connected via", envFile, "candidate", candidateIndex);
  console.log("Supabase project ref:", projectRef(url));

  try {
    const grouped = await fetchFunctionDefs(pg, "production");
    printFunctionDefReport("production", grouped);
  } finally {
    await pg.end();
  }
}

async function signInUser(
  url: string,
  anonKey: string,
  email: string,
): Promise<{ client: SupabaseClient; error: string | null }> {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error) {
    return { client, error: error.message };
  }
  return { client, error: null };
}

async function findDirectorCandidates(
  admin: SupabaseClient,
): Promise<DirectorCandidate[]> {
  const { data: rows, error } = await admin
    .from("user_accounts")
    .select("auth_uid, email, tenant_id, is_active")
    .eq("role", "director")
    .order("email", { ascending: true });

  if (error) {
    throw new Error(`user_accounts director query: ${error.message}`);
  }

  const candidates: DirectorCandidate[] = [];
  for (const row of rows ?? []) {
    const { data: authData, error: authError } =
      await admin.auth.admin.getUserById(row.auth_uid);
    candidates.push({
      auth_uid: row.auth_uid,
      email: row.email,
      tenant_id: row.tenant_id,
      is_active: row.is_active,
      auth_email: authData?.user?.email ?? null,
      auth_exists: !authError && Boolean(authData?.user),
    });
  }
  return candidates;
}

async function pickClientWithRosterConfig(admin: SupabaseClient) {
  for (const clientId of CANDIDATE_CLIENT_IDS) {
    const { data, error } = await admin
      .from("roster_config")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) {
      throw new Error(`roster_config ${clientId}: ${error.message}`);
    }
    if (data) {
      const { data: customer } = await admin
        .from("customers")
        .select("client_id, client_name")
        .eq("client_id", clientId)
        .maybeSingle();
      return {
        clientId,
        config: data,
        clientName: customer?.client_name ?? clientId,
      };
    }
  }

  const { data: configs, error: cfgError } = await admin
    .from("roster_config")
    .select("client_id")
    .ilike("client_id", "CL%")
    .limit(20);
  if (cfgError) throw new Error(cfgError.message);

  throw new Error(
    `No roster_config for ${CANDIDATE_CLIENT_IDS.join(" or ")}; sample client_ids: ${(configs ?? []).map((c) => c.client_id).join(", ") || "(none)"}`,
  );
}

type RoleProbeResult = {
  roleLabel: string;
  email: string;
  signedIn: boolean;
  signInError: string | null;
  account: {
    role: string | null;
    tenant_id: string | null;
    client_id: string | null;
  } | null;
  counts: {
    rpc_get_duty_roster_employee_display: number | null;
    rpc_error: string | null;
    sites_for_client: number | null;
    sites_error: string | null;
    projects_visible: number | null;
    projects_error: string | null;
    roster_history_visible: number | null;
    roster_history_error: string | null;
    roster_config_for_client: unknown | null;
    roster_config_error: string | null;
    customers_for_client: number | null;
    employees_table_visible: number | null;
    employees_error: string | null;
  };
  viewModel: {
    built: boolean;
    reason: string | null;
    currentRotationNumber: number | null;
    staffAssignedCount: number | null;
    totalActiveCount: number | null;
    staffAssignedPercent: number | null;
    rosterRows: number | null;
    totalsRequiredStaff: number | null;
    totalsActualStaff: number | null;
  };
};

async function probeRoleForClient(
  url: string,
  anonKey: string,
  email: string,
  roleLabel: string,
  clientId: string,
  clientName: string,
): Promise<RoleProbeResult> {
  const base: RoleProbeResult = {
    roleLabel,
    email,
    signedIn: false,
    signInError: null,
    account: null,
    counts: {
      rpc_get_duty_roster_employee_display: null,
      rpc_error: null,
      sites_for_client: null,
      sites_error: null,
      projects_visible: null,
      projects_error: null,
      roster_history_visible: null,
      roster_history_error: null,
      roster_config_for_client: null,
      roster_config_error: null,
      customers_for_client: null,
      employees_table_visible: null,
      employees_error: null,
    },
    viewModel: {
      built: false,
      reason: null,
      currentRotationNumber: null,
      staffAssignedCount: null,
      totalActiveCount: null,
      staffAssignedPercent: null,
      rosterRows: null,
      totalsRequiredStaff: null,
      totalsActualStaff: null,
    },
  };

  const { client, error: signInError } = await signInUser(url, anonKey, email);
  if (signInError) {
    base.signInError = signInError;
    return base;
  }
  base.signedIn = true;

  const { data: account } = await client
    .from("user_accounts")
    .select("role, tenant_id, client_id")
    .maybeSingle();
  base.account = account ?? null;

  const [
    rpcRes,
    sitesRes,
    projectsRes,
    historyRes,
    configRes,
    customersRes,
    employeesRes,
    allSitesRes,
  ] = await Promise.all([
    client.rpc("get_duty_roster_employee_display"),
    client
      .from("sites")
      .select("site_code", { count: "exact", head: true })
      .eq("client_id", clientId),
    client.from("projects").select("project_code", { count: "exact", head: true }),
    client
      .from("roster_history")
      .select("employee_id", { count: "exact", head: true }),
    client.from("roster_config").select("*").eq("client_id", clientId).maybeSingle(),
    client
      .from("customers")
      .select("client_id", { count: "exact", head: true })
      .eq("client_id", clientId),
    client
      .from("employees")
      .select("employee_id", { count: "exact", head: true }),
    client.from("sites").select("*"),
  ]);

  base.counts.rpc_get_duty_roster_employee_display = rpcRes.error
    ? null
    : (rpcRes.data?.length ?? 0);
  base.counts.rpc_error = rpcRes.error?.message ?? null;
  base.counts.sites_for_client = sitesRes.error ? null : (sitesRes.count ?? 0);
  base.counts.sites_error = sitesRes.error?.message ?? null;
  base.counts.projects_visible = projectsRes.error ? null : (projectsRes.count ?? 0);
  base.counts.projects_error = projectsRes.error?.message ?? null;
  base.counts.roster_history_visible = historyRes.error
    ? null
    : (historyRes.count ?? 0);
  base.counts.roster_history_error = historyRes.error?.message ?? null;
  base.counts.roster_config_for_client = configRes.error ? null : (configRes.data ?? null);
  base.counts.roster_config_error = configRes.error?.message ?? null;
  base.counts.customers_for_client = customersRes.error
    ? null
    : (customersRes.count ?? 0);
  base.counts.employees_table_visible = employeesRes.error
    ? null
    : (employeesRes.count ?? 0);
  base.counts.employees_error = employeesRes.error?.message ?? null;

  const config = configRes.data
    ? getRosterConfigForClient([configRes.data], clientId)
    : null;

  if (!config) {
    base.viewModel.reason = "no roster_config for client";
    return base;
  }

  if (rpcRes.error || !rpcRes.data) {
    base.viewModel.reason = rpcRes.error?.message ?? "rpc returned no rows";
    return base;
  }

  const employees = (rpcRes.data as Record<string, unknown>[]).map((row) =>
    normalizeDutyRosterEmployee(
      row as Parameters<typeof normalizeDutyRosterEmployee>[0],
    ),
  );
  const { data: projects } = await client.from("projects").select("*");
  const sites = allSitesRes.error ? [] : (allSitesRes.data ?? []);
  const { data: history } = await client.from("roster_history").select("*");

  const vm = buildDutyRosterViewModel({
    clientId,
    clientName,
    config,
    employees,
    projects: (projects ?? []).map((p) => normalizeProjectEntry(p)),
    sites: sites.map((s) => normalizeDutyRosterSite(s)),
    history: history ?? [],
  });

  base.viewModel = {
    built: true,
    reason: null,
    currentRotationNumber: vm.currentRotationNumber,
    staffAssignedCount: vm.summary.staffAssignedCount,
    totalActiveCount: vm.summary.totalActiveCount,
    staffAssignedPercent: vm.summary.staffAssignedPercent,
    rosterRows: vm.rows.length,
    totalsRequiredStaff: vm.totals.requiredStaff,
    totalsActualStaff: vm.totals.totalStaff,
  };

  return base;
}


type PgSimProbe = {
  roleLabel: string;
  email: string | null;
  auth_uid: string;
  counts: {
    rpc_get_duty_roster_employee_display: number;
    sites_for_client: number;
    projects_visible: number;
    roster_history_visible: number;
    roster_config_present: boolean;
    employees_table_visible: number;
  };
};

async function probeViaPgSimulation(
  pg: import("pg").Client,
  authUid: string,
  roleLabel: string,
  email: string | null,
  clientId: string,
  clientName: string,
): Promise<PgSimProbe & { viewModel: RoleProbeResult["viewModel"] }> {
  await pg.query("BEGIN");
  try {
    await pg.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [authUid]);
    await pg.query("SET LOCAL ROLE authenticated");

    const rpc = await pg.query(
      "SELECT count(*)::int AS count FROM get_duty_roster_employee_display()",
    );
    const sites = await pg.query(
      "SELECT count(*)::int AS count FROM sites WHERE client_id = $1",
      [clientId],
    );
    const projects = await pg.query("SELECT count(*)::int AS count FROM projects");
    const history = await pg.query("SELECT count(*)::int AS count FROM roster_history");
    const config = await pg.query(
      "SELECT * FROM roster_config WHERE client_id = $1 LIMIT 1",
      [clientId],
    );
    const employees = await pg.query("SELECT count(*)::int AS count FROM employees");

    const rpcRows = await pg.query("SELECT * FROM get_duty_roster_employee_display()");
    const projectRows = await pg.query("SELECT * FROM projects");
    const siteRows = await pg.query("SELECT * FROM sites");
    const historyRows = await pg.query("SELECT * FROM roster_history");

    const cfgRaw = config.rows[0] ?? null;
    const cfg = cfgRaw
      ? {
          ...cfgRaw,
          cycle_start_date:
            cfgRaw.cycle_start_date instanceof Date
              ? cfgRaw.cycle_start_date.toISOString().slice(0, 10)
              : String(cfgRaw.cycle_start_date),
        }
      : null;
    let viewModel: RoleProbeResult["viewModel"] = {
      built: false,
      reason: cfg ? null : "no roster_config for client",
      currentRotationNumber: null,
      staffAssignedCount: null,
      totalActiveCount: null,
      staffAssignedPercent: null,
      rosterRows: null,
      totalsRequiredStaff: null,
      totalsActualStaff: null,
    };

    if (cfg) {
      const rosterConfig = getRosterConfigForClient(
        [cfg as RosterConfigRecord],
        clientId,
      );
      if (rosterConfig) {
        const vm = buildDutyRosterViewModel({
          clientId,
          clientName,
          config: rosterConfig,
          employees: rpcRows.rows.map((row) =>
            normalizeDutyRosterEmployee(
              row as Parameters<typeof normalizeDutyRosterEmployee>[0],
            ),
          ),
          projects: projectRows.rows.map((row) =>
            normalizeProjectEntry(
              row as Parameters<typeof normalizeProjectEntry>[0],
            ),
          ),
          sites: siteRows.rows.map((row) =>
            normalizeDutyRosterSite(
              row as Parameters<typeof normalizeDutyRosterSite>[0],
            ),
          ),
          history: historyRows.rows as RosterHistoryRecord[],
        });
        viewModel = {
          built: true,
          reason: null,
          currentRotationNumber: vm.currentRotationNumber,
          staffAssignedCount: vm.summary.staffAssignedCount,
          totalActiveCount: vm.summary.totalActiveCount,
          staffAssignedPercent: vm.summary.staffAssignedPercent,
          rosterRows: vm.rows.length,
          totalsRequiredStaff: vm.totals.requiredStaff,
          totalsActualStaff: vm.totals.totalStaff,
        };
      }
    }

    return {
      roleLabel,
      email,
      auth_uid: authUid,
      counts: {
        rpc_get_duty_roster_employee_display: pgCount(rpc.rows),
        sites_for_client: pgCount(sites.rows),
        projects_visible: pgCount(projects.rows),
        roster_history_visible: pgCount(history.rows),
        roster_config_present: Boolean(cfg),
        employees_table_visible: pgCount(employees.rows),
      },
      viewModel,
    };
  } finally {
    await pg.query("ROLLBACK");
  }
}

async function runStagingSection() {
  const stagingPath = resolve(process.cwd(), STAGING_ENV);
  if (!existsSync(stagingPath)) {
    throw new Error(`Missing ${STAGING_ENV}`);
  }

  loadEnvForce(stagingPath);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url.includes(STAGING_REF)) {
    throw new Error(
      `Refusing staging section: ref is ${projectRef(url)}, expected ${STAGING_REF}`,
    );
  }
  if (!anonKey || !serviceKey) {
    throw new Error("Missing staging anon or service role key");
  }

  console.log("\n=== STAGING function defs (pg) ===");
  console.log("Env file:", STAGING_ENV);
  console.log("Supabase project ref:", projectRef(url));

  let stagingPg: import("pg").Client | null = null;
  try {
    const connected = await connectPg({
      envFiles: [STAGING_ENV],
      requiredProjectRef: STAGING_REF,
    });
    stagingPg = connected.client;
    console.log(
      "Postgres connected via",
      connected.envFile,
      "candidate",
      connected.candidateIndex,
    );
    const grouped = await fetchFunctionDefs(stagingPg, "staging");
    printFunctionDefReport("staging", grouped);
  } catch (err) {
    console.log(
      "Staging Postgres unavailable:",
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    if (stagingPg) await stagingPg.end();
  }

  const { createAdminClient } = await import("../utils/supabase/admin");
  const admin = createAdminClient();

  console.log("\n--- Director user_accounts (service role) ---");
  const directors = await findDirectorCandidates(admin);
  console.log(JSON.stringify(directors, null, 2));

  let directorEmail: string | null = null;
  for (const candidate of directors) {
    const email = candidate.auth_email ?? candidate.email;
    if (!email) continue;
    const { error } = await signInUser(url, anonKey, email);
    if (!error) {
      directorEmail = email;
      console.log(`Director sign-in OK: ${email}`);
      break;
    }
    console.log(`Director sign-in failed for ${email}: ${error}`);
  }

  if (!directorEmail) {
    console.log(
      "No director account signed in with TestRbac1!; skipping director role probe.",
    );
  }

  const { clientId, clientName, config: adminConfig } =
    await pickClientWithRosterConfig(admin);
  console.log("\n--- Central University client selection ---");
  console.log(
    JSON.stringify(
      {
        clientId,
        clientName,
        roster_config_admin: adminConfig,
      },
      null,
      2,
    ),
  );

  const { count: adminSitesCount } = await admin
    .from("sites")
    .select("site_code", { count: "exact", head: true })
    .eq("client_id", clientId);
  const { count: adminProjectsCount } = await admin
    .from("projects")
    .select("project_code", { count: "exact", head: true });
  const { count: adminHistoryCount } = await admin
    .from("roster_history")
    .select("employee_id", { count: "exact", head: true });
  const { data: adminRpc } = await admin.rpc("get_duty_roster_employee_display");

  console.log("\n--- Service-role baseline counts ---");
  console.log(
    JSON.stringify(
      {
        clientId,
        rpc_get_duty_roster_employee_display: adminRpc?.length ?? 0,
        sites_for_client: adminSitesCount ?? 0,
        projects_total: adminProjectsCount ?? 0,
        roster_history_total: adminHistoryCount ?? 0,
      },
      null,
      2,
    ),
  );

  console.log("\n--- Role probes (authenticated) ---");
  const probes: RoleProbeResult[] = [];

  probes.push(
    await probeRoleForClient(
      url,
      anonKey,
      SUPER_ADMIN_EMAIL,
      "super_admin",
      clientId,
      clientName,
    ),
  );

  if (directorEmail) {
    probes.push(
      await probeRoleForClient(
        url,
        anonKey,
        directorEmail,
        "director",
        clientId,
        clientName,
      ),
    );
  }

  console.log(JSON.stringify(probes, null, 2));

  console.log("\n--- Comparison summary ---");
  const superAdmin = probes.find((p) => p.roleLabel === "super_admin");
  const director = probes.find((p) => p.roleLabel === "director");

  function diffLine(label: string, a: unknown, b: unknown) {
    const match = a === b;
    console.log(
      `${label}: super_admin=${JSON.stringify(a)} director=${JSON.stringify(b)} ${match ? "MATCH" : "DIFF"}`,
    );
  }

  if (superAdmin && director) {
    diffLine(
      "rpc count",
      superAdmin.counts.rpc_get_duty_roster_employee_display,
      director.counts.rpc_get_duty_roster_employee_display,
    );
    diffLine(
      "sites for client",
      superAdmin.counts.sites_for_client,
      director.counts.sites_for_client,
    );
    diffLine(
      "projects visible",
      superAdmin.counts.projects_visible,
      director.counts.projects_visible,
    );
    diffLine(
      "roster_history visible",
      superAdmin.counts.roster_history_visible,
      director.counts.roster_history_visible,
    );
    diffLine(
      "employees table visible",
      superAdmin.counts.employees_table_visible,
      director.counts.employees_table_visible,
    );
    diffLine(
      "VM staffAssignedCount",
      superAdmin.viewModel.staffAssignedCount,
      director.viewModel.staffAssignedCount,
    );
    diffLine(
      "VM currentRotationNumber",
      superAdmin.viewModel.currentRotationNumber,
      director.viewModel.currentRotationNumber,
    );
    diffLine(
      "VM rosterRows",
      superAdmin.viewModel.rosterRows,
      director.viewModel.rosterRows,
    );
  } else {
    console.log(
      "Director probe unavailable; printed super_admin only above.",
    );
  }

  const authProbeOk = probes.some((p) => p.signedIn);
  if (!authProbeOk || !director) {
    console.log("\n--- PG authenticated role simulation fallback ---");
    const { client: simPg } = await connectPg({
      envFiles: [STAGING_ENV],
      requiredProjectRef: STAGING_REF,
    });
    try {
      const { data: superRows, error: superErr } = await admin
        .from("user_accounts")
        .select("auth_uid, email")
        .eq("role", "super_admin")
        .eq("tenant_id", "00000001-0000-4000-8000-000000000001")
        .order("email", { ascending: true })
        .limit(5);
      if (superErr) throw new Error(superErr.message);

      const superPick =
        superRows?.find((row) => row.email === SUPER_ADMIN_EMAIL) ??
        superRows?.[0] ??
        null;
      const directorPick =
        directors.find(
          (row) => row.tenant_id === "00000001-0000-4000-8000-000000000001",
        ) ??
        directors[0] ??
        null;

      const simResults = [];
      if (superPick?.auth_uid) {
        simResults.push(
          await probeViaPgSimulation(
            simPg,
            superPick.auth_uid,
            "super_admin",
            superPick.email ?? null,
            clientId,
            clientName,
          ),
        );
      }
      if (directorPick?.auth_uid) {
        simResults.push(
          await probeViaPgSimulation(
            simPg,
            directorPick.auth_uid,
            "director",
            directorPick.auth_email ?? directorPick.email,
            clientId,
            clientName,
          ),
        );
      }

      console.log(JSON.stringify(simResults, null, 2));

      const simSuper = simResults.find((r) => r.roleLabel === "super_admin");
      const simDirector = simResults.find((r) => r.roleLabel === "director");
      if (simSuper && simDirector) {
        console.log("\n--- PG simulation comparison summary ---");
        diffLine(
          "rpc count",
          simSuper.counts.rpc_get_duty_roster_employee_display,
          simDirector.counts.rpc_get_duty_roster_employee_display,
        );
        diffLine(
          "sites for client",
          simSuper.counts.sites_for_client,
          simDirector.counts.sites_for_client,
        );
        diffLine(
          "projects visible",
          simSuper.counts.projects_visible,
          simDirector.counts.projects_visible,
        );
        diffLine(
          "roster_history visible",
          simSuper.counts.roster_history_visible,
          simDirector.counts.roster_history_visible,
        );
        diffLine(
          "employees table visible",
          simSuper.counts.employees_table_visible,
          simDirector.counts.employees_table_visible,
        );
        diffLine(
          "VM staffAssignedCount",
          simSuper.viewModel.staffAssignedCount,
          simDirector.viewModel.staffAssignedCount,
        );
        diffLine(
          "VM currentRotationNumber",
          simSuper.viewModel.currentRotationNumber,
          simDirector.viewModel.currentRotationNumber,
        );
        diffLine(
          "VM rosterRows",
          simSuper.viewModel.rosterRows,
          simDirector.viewModel.rosterRows,
        );
      }
    } finally {
      await simPg.end();
    }
  }
}

async function main() {
  await runProductionSection();
  await runStagingSection();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

