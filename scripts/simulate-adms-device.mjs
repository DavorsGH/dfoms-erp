/**
 * ZKTeco ADMS device simulator (Node 20+, built-in fetch).
 *
 * Example PowerShell:
 *
 *   # Handshake only
 *   node scripts/simulate-adms-device.mjs --sn TEST-SN-001 --handshake
 *
 *   # Single punch
 *   node scripts/simulate-adms-device.mjs --sn TEST-SN-001 --punch "1001,2026-03-01 08:00:00"
 *
 *   # Offline batch file (one ATTLOG line per row: PIN<TAB>YYYY-MM-DD HH:MM:SS<TAB>...)
 *   node scripts/simulate-adms-device.mjs --sn TEST-SN-001 --batch-file .\punches.txt
 *
 *   # Duplicate resend test
 *   node scripts/simulate-adms-device.mjs --sn TEST-SN-001 --punch "1001,2026-03-01 08:00:00" --repeat 3
 *
 *   # Unknown serial
 *   node scripts/simulate-adms-device.mjs --unknown --handshake
 */

function parseArgs(argv) {
  const options = {
    baseUrl: "http://localhost:3000",
    sn: "",
    handshake: false,
    punches: [],
    batchFile: "",
    repeat: 1,
    unknown: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--base-url") {
      options.baseUrl = argv[++index] ?? options.baseUrl;
      continue;
    }
    if (token === "--sn") {
      options.sn = argv[++index] ?? "";
      continue;
    }
    if (token === "--handshake") {
      options.handshake = true;
      continue;
    }
    if (token === "--punch") {
      options.punches.push(argv[++index] ?? "");
      continue;
    }
    if (token === "--batch-file") {
      options.batchFile = argv[++index] ?? "";
      continue;
    }
    if (token === "--repeat") {
      options.repeat = Math.max(1, Number.parseInt(argv[++index] ?? "1", 10) || 1);
      continue;
    }
    if (token === "--unknown") {
      options.unknown = true;
      continue;
    }
  }

  if (options.unknown) {
    options.sn = `UNK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  }

  return options;
}

async function readBatchLines(path) {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function punchCsvToAttlogLine(csv) {
  const [pin, datetime] = csv.split(",").map((part) => part.trim());
  return `${pin}\t${datetime}\t0\t1\t0`;
}

async function request(method, url, body) {
  console.log(`\n>>> ${method} ${url}`);
  if (body) {
    console.log(body);
  }
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "text/plain" } : undefined,
    body,
  });
  const text = await response.text();
  console.log(`<<< ${response.status} ${response.headers.get("content-type") ?? ""}`);
  console.log(text);
  return { response, text };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.sn) {
    console.error("Provide --sn or --unknown");
    process.exit(1);
  }

  const base = options.baseUrl.replace(/\/$/, "");
  const sn = encodeURIComponent(options.sn);

  if (options.handshake) {
    const url = `${base}/iclock/cdata?SN=${sn}&options=all&pushver=1.0.0&language=0`;
    await request("GET", url);
  }

  let attlogLines = [];
  if (options.batchFile) {
    attlogLines = await readBatchLines(options.batchFile);
  }
  for (const punch of options.punches) {
    attlogLines.push(punchCsvToAttlogLine(punch));
  }

  if (attlogLines.length > 0) {
    const body = attlogLines.join("\n");
    const url = `${base}/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=9999`;
    for (let attempt = 0; attempt < options.repeat; attempt += 1) {
      if (options.repeat > 1) {
        console.log(`\n--- repeat ${attempt + 1}/${options.repeat} ---`);
      }
      await request("POST", url, body);
    }
  }

  await request("GET", `${base}/iclock/getrequest?SN=${sn}`);
  await request("GET", `${base}/iclock/ping?SN=${sn}`);
  await request("POST", `${base}/iclock/devicecmd?SN=${sn}`, "OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
