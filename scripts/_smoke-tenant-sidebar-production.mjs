const base = "https://portal.davorsfacilities.com";

const portal = await fetch(`${base}/portal`, { redirect: "manual" });
console.log("/portal status:", portal.status, "location:", portal.headers.get("location"));

const login = await fetch(`${base}/portal/login`);
const loginHtml = await login.text();
console.log("login page has Tenant Portal:", loginHtml.includes("Tenant Portal"));

const oldNav =
  loginHtml.includes("portal-nav") ||
  /overflow-x-auto[\s\S]{0,200}Home[\s\S]{0,200}Payments/.test(loginHtml);
console.log("old horizontal tab nav markers on login:", oldNav);

const dash = await fetch(`${base}/portal/dashboard`, { redirect: "manual" });
console.log(
  "/portal/dashboard unauth:",
  dash.status,
  dash.headers.get("location"),
);

const chunks = [
  ...loginHtml.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g),
]
  .slice(0, 30)
  .map((m) => m[0]);

let foundSidebar = false;
for (const chunk of chunks) {
  try {
    const r = await fetch(`${base}${chunk}`);
    const t = await r.text();
    if (
      t.includes("portal-sidebar") ||
      t.includes("TenantPortalSidebar") ||
      t.includes("portal-dashboard-shell") ||
      t.includes("#0f2744")
    ) {
      foundSidebar = true;
      console.log("sidebar shell marker in chunk:", chunk);
      break;
    }
  } catch {
    // ignore chunk fetch errors
  }
}

console.log("production bundle includes new sidebar shell:", foundSidebar);
