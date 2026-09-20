/**
 * Read-only: scan live production bundle for BU feature strings + deployment meta.
 */
const PRODUCTION_URL = "https://portal.davorsfacilities.com";
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";

const NEEDLES = [
  "user_business_unit_access",
  "BusinessUnitAccessFields",
  "getUserAllowedBusinessUnits",
  "BUSINESS_UNIT_ACCESS_DENIED",
  "syncBusinessUnitAccess",
  "business-unit-access.server",
  "loadWriteBusinessUnitContext",
  "resolveServerWriteBusinessUnitId",
  "business-unit-view",
  "dfoms-bu-view-all-no-lock",
];

const NEXT_STATIC_JS_RE = /\/_next\/static\/[^"' ]+\.js/g;

async function fetchText(url: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "dfoms-probe-production-deploy/1.0",
      "x-vercel-protection-bypass": BYPASS,
    },
  });
  return { status: res.status, finalUrl: res.url, text: await res.text(), headers: res.headers };
}

async function main() {
  const metaPaths = ["/login", "/dashboard/administration/user-accounts"];
  const meta: Record<string, unknown> = {};

  for (const path of metaPaths) {
    const res = await fetch(`${PRODUCTION_URL}${path}`, {
      redirect: "follow",
      headers: {
        "User-Agent": "dfoms-probe-production-deploy/1.0",
        "x-vercel-protection-bypass": BYPASS,
      },
    });
    meta[path] = {
      status: res.status,
      finalUrl: res.url,
      "x-vercel-id": res.headers.get("x-vercel-id"),
      "x-vercel-git-commit-sha": res.headers.get("x-vercel-git-commit-sha"),
      "x-vercel-git-commit-ref": res.headers.get("x-vercel-git-commit-ref"),
      "x-vercel-git-commit-message": res.headers.get("x-vercel-git-commit-message"),
      "x-vercel-deployment-url": res.headers.get("x-vercel-deployment-url"),
    };
  }

  const login = await fetchText(`${PRODUCTION_URL}/login`);
  const refs = [...new Set(login.text.match(NEXT_STATIC_JS_RE) ?? [])];
  const hits: Array<{ ref: string; needle: string }> = [];
  let downloaded = 0;
  for (const ref of refs) {
    const chunk = await fetchText(`${PRODUCTION_URL}${ref}`);
    downloaded += 1;
    for (const needle of NEEDLES) {
      if (chunk.text.includes(needle)) hits.push({ ref, needle });
    }
  }

  console.log(
    JSON.stringify(
      {
        production_url: PRODUCTION_URL,
        deployment_meta: meta,
        chunk_count: refs.length,
        chunks_downloaded: downloaded,
        bu_string_hits: hits,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
