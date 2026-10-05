/**
 * Move employee-photos objects from flat "{employee_id}.{ext}" to "{tenant_id}/{employee_id}.{ext}".
 *
 * Usage (staging — default):
 *   npx tsx scripts/migrate-employee-photos-to-tenant-folders.ts
 *
 * Dry run:
 *   npx tsx scripts/migrate-employee-photos-to-tenant-folders.ts --dry-run
 *
 * Production:
 *   ALLOW_PRODUCTION_EMPLOYEE_PHOTO_MIGRATE=true npx tsx scripts/migrate-employee-photos-to-tenant-folders.ts --env=production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const BUCKET = "employee-photos";
const TENANT_PREFIX = /^[0-9a-f-]{36}\//i;
const FLAT_OBJECT = /^[^/]+\.(jpe?g|png|webp)$/i;

type Counts = {
  moved: number;
  skippedNoEmployee: number;
  failed: number;
};

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function resolveEnvFile(): string {
  const envArg = process.argv.find((arg) => arg.startsWith("--env="));
  const envName = envArg?.split("=")[1] ?? "staging";
  if (envName === "production") {
    for (const file of [".env.local.backup", ".env.vercel.production.local"]) {
      try {
        readFileSync(resolve(process.cwd(), file), "utf8");
        return file;
      } catch {
        /* try next */
      }
    }
    return ".env.local.backup";
  }
  return ".env.staging.local";
}

function assertAllowedTarget(supabaseUrl: string) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const allowProduction =
    process.env.ALLOW_PRODUCTION_EMPLOYEE_PHOTO_MIGRATE === "true";
  const envArg = process.argv.find((arg) => arg.startsWith("--env="));
  const envName = envArg?.split("=")[1] ?? "staging";

  if (envName === "production") {
    if (!allowProduction) {
      throw new Error(
        "Refusing production migrate. Set ALLOW_PRODUCTION_EMPLOYEE_PHOTO_MIGRATE=true and pass --env=production.",
      );
    }
    if (ref !== PRODUCTION_PROJECT_REF) {
      throw new Error(
        `Refusing production migrate: expected ${PRODUCTION_PROJECT_REF}, got ${ref}.`,
      );
    }
    console.warn(`WARNING: migrating employee photos on production (${ref}).`);
    return;
  }

  if (ref !== STAGING_PROJECT_REF) {
    throw new Error(
      `Refusing migrate: expected staging project ${STAGING_PROJECT_REF}, got ${ref}.`,
    );
  }
}

async function listAllObjectPaths(
  admin: ReturnType<typeof createClient>,
  folder = "",
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await admin.storage.from(BUCKET).list(folder, {
      limit: 100,
      offset,
    });
    if (error) {
      throw new Error(`list failed (${folder || "/"}): ${error.message}`);
    }
    if (!data || data.length === 0) {
      break;
    }

    for (const row of data) {
      const name = row.name;
      const fullPath = folder ? `${folder}/${name}` : name;
      const isFile = Boolean(row.id) || FLAT_OBJECT.test(name);
      if (isFile && !name.endsWith("/")) {
        paths.push(fullPath);
      } else if (!isFile) {
        paths.push(...(await listAllObjectPaths(admin, fullPath)));
      }
    }

    if (data.length < 100) {
      break;
    }
    offset += data.length;
  }

  return paths;
}

function employeeIdFromFlatPath(path: string): string | null {
  const base = path.split("/").pop() ?? path;
  const match = /^(.+)\.(jpe?g|png|webp)$/i.exec(base);
  return match ? match[1] : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const envFile = resolveEnvFile();
  loadEnvForce(resolve(process.cwd(), envFile));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.");
  }

  assertAllowedTarget(supabaseUrl);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const counts: Counts = { moved: 0, skippedNoEmployee: 0, failed: 0 };
  const allPaths = await listAllObjectPaths(admin);
  const flatPaths = allPaths.filter(
    (path) => FLAT_OBJECT.test(path) && !TENANT_PREFIX.test(path),
  );

  console.log(
    `Found ${flatPaths.length} flat employee photo object(s) to process (${dryRun ? "dry-run" : "live"}).`,
  );

  for (const oldPath of flatPaths) {
    const employeeId = employeeIdFromFlatPath(oldPath);
    if (!employeeId) {
      counts.failed += 1;
      console.warn(`FAIL ${oldPath}: could not parse employee id`);
      continue;
    }

    const { data: employee, error: employeeError } = await admin
      .from("employees")
      .select("tenant_id, photo_url")
      .eq("employee_id", employeeId)
      .maybeSingle();

    if (employeeError) {
      counts.failed += 1;
      console.warn(`FAIL ${oldPath}: ${employeeError.message}`);
      continue;
    }

    if (!employee?.tenant_id) {
      counts.skippedNoEmployee += 1;
      console.warn(`SKIP ${oldPath}: no matching employee / tenant_id`);
      continue;
    }

    const tenantId = String(employee.tenant_id);
    const newPath = `${tenantId}/${oldPath.split("/").pop()}`;

    if (dryRun) {
      console.log(`PLAN move ${oldPath} -> ${newPath} (employee ${employeeId})`);
      counts.moved += 1;
      continue;
    }

    const { error: copyError } = await admin.storage
      .from(BUCKET)
      .copy(oldPath, newPath);

    if (copyError) {
      counts.failed += 1;
      console.warn(`FAIL copy ${oldPath}: ${copyError.message}`);
      continue;
    }

    const { error: updateError } = await admin
      .from("employees")
      .update({ photo_url: newPath })
      .eq("employee_id", employeeId)
      .eq("tenant_id", tenantId);

    if (updateError) {
      counts.failed += 1;
      console.warn(`FAIL db ${oldPath}: ${updateError.message}`);
      await admin.storage.from(BUCKET).remove([newPath]);
      continue;
    }

    const { error: removeError } = await admin.storage.from(BUCKET).remove([oldPath]);
    if (removeError) {
      counts.failed += 1;
      console.warn(
        `FAIL delete old ${oldPath} (new copy exists at ${newPath}): ${removeError.message}`,
      );
      continue;
    }

    counts.moved += 1;
    console.log(`OK ${oldPath} -> ${newPath}`);
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        moved: counts.moved,
        skippedNoEmployee: counts.skippedNoEmployee,
        failed: counts.failed,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
