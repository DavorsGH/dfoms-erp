import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL missing");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const rlsTables = await client.query(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relrowsecurity = true
      ORDER BY c.relname
    `);

    const policies = await client.query(`
      SELECT schemaname, tablename, policyname, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname
    `);

    const indexes = await client.query(`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        pg_get_indexdef(ix.indexrelid) AS index_def,
        array_agg(a.attname ORDER BY x.n) AS columns
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n) ON true
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
      WHERE n.nspname = 'public'
        AND t.relrowsecurity = true
      GROUP BY t.relname, i.relname, ix.indexrelid
      ORDER BY t.relname, i.relname
    `);

    const fkColumns = await client.query(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table,
        ccu.column_name AS foreign_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = ANY($1::text[])
      ORDER BY tc.table_name, kcu.column_name
    `, [rlsTables.rows.map((r) => r.table_name)]);

    // Candidate filter columns commonly used in RLS
    const candidateCols = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
        AND (
          column_name IN (
            'site_id', 'assigned_site_id', 'client_id', 'employee_id',
            'project_id', 'contract_project', 'auth_uid', 'user_id',
            'supervisor_id', 'created_by', 'recorded_by'
          )
          OR column_name LIKE '%site%id%'
          OR column_name LIKE '%client%id%'
          OR column_name LIKE '%employee%id%'
          OR column_name LIKE '%project%id%'
        )
      ORDER BY table_name, column_name
    `, [rlsTables.rows.map((r) => r.table_name)]);

    // Build index coverage map: table -> set of first-column indexes + all indexed cols
    const indexedByTable = new Map();
    for (const idx of indexes.rows) {
      if (!indexedByTable.has(idx.table_name)) {
        indexedByTable.set(idx.table_name, { firstCols: new Set(), allCols: new Set(), defs: [] });
      }
      const entry = indexedByTable.get(idx.table_name);
      const cols = idx.columns;
      if (cols?.length) {
        entry.firstCols.add(cols[0]);
        for (const col of cols) entry.allCols.add(col);
      }
      entry.defs.push({ name: idx.index_name, def: idx.index_def, columns: cols });
    }

    const missing = [];
    for (const col of candidateCols.rows) {
      const coverage = indexedByTable.get(col.table_name);
      const hasAsLeading = coverage?.firstCols.has(col.column_name) ?? false;
      if (!hasAsLeading) {
        missing.push({
          table: col.table_name,
          column: col.column_name,
          data_type: col.data_type,
          indexedAnywhere: coverage?.allCols.has(col.column_name) ?? false,
        });
      }
    }

    // Also include FK columns not leading an index
    for (const fk of fkColumns.rows) {
      const coverage = indexedByTable.get(fk.table_name);
      const hasAsLeading = coverage?.firstCols.has(fk.column_name) ?? false;
      if (!hasAsLeading) {
        const already = missing.some(
          (m) => m.table === fk.table_name && m.column === fk.column_name,
        );
        if (!already) {
          missing.push({
            table: fk.table_name,
            column: fk.column_name,
            data_type: "fk",
            foreign: `${fk.foreign_table}.${fk.foreign_column}`,
            indexedAnywhere: coverage?.allCols.has(fk.column_name) ?? false,
          });
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          rlsTableCount: rlsTables.rows.length,
          rlsTables: rlsTables.rows.map((r) => r.table_name),
          policyCount: policies.rows.length,
          candidateFilterColumns: candidateCols.rows,
          missingLeadingIndexes: missing,
          indexSummary: [...indexedByTable.entries()].map(([table, info]) => ({
            table,
            indexes: info.defs.map((d) => ({ name: d.name, columns: d.columns })),
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
