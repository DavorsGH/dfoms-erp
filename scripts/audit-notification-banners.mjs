import fs from "node:fs";
import path from "node:path";

const roots = [
  ["Finance", "app/dashboard/finance"],
  [
    "Sales & CRM",
    ["app/dashboard/crm", "app/dashboard/sales-crm", "app/dashboard/pos"],
  ],
  ["Inventory", "app/dashboard/inventory"],
  ["Operations", "app/dashboard/operations"],
  [
    "HR",
    [
      "app/dashboard/hr-payroll",
      "app/dashboard/employees",
      "app/dashboard/leave-approvals",
    ],
  ],
  ["Real Estate", "app/dashboard/real-estate"],
  [
    "Self-Service",
    ["app/dashboard/self-service", "app/dashboard/client-portal"],
  ],
  ["Reports", "app/dashboard/reports"],
  [
    "Administration",
    [
      "app/dashboard/administration",
      "app/dashboard/my-account",
      "app/dashboard/bulk-import",
    ],
  ],
  ["Portals", ["app/portal", "app/landlord-portal", "app/facility-portal"]],
];

const patterns = {
  redBanner: /border-red-200 bg-red-50/g,
  alert: /\balert\s*\(/g,
  confirm: /\bconfirm\s*\(/g,
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

for (const [name, dirs] of roots) {
  const dirList = Array.isArray(dirs) ? dirs : [dirs];
  let redBanner = 0;
  let alert = 0;
  let confirm = 0;
  let files = 0;
  for (const dir of dirList) {
    for (const file of walk(dir)) {
      const text = fs.readFileSync(file, "utf8");
      let hit = false;
      for (const [key, re] of Object.entries(patterns)) {
        const matches = text.match(re);
        if (matches) {
          if (key === "redBanner") redBanner += matches.length;
          if (key === "alert") alert += matches.length;
          if (key === "confirm") confirm += matches.length;
          hit = true;
        }
      }
      if (hit) files += 1;
    }
  }
  console.log(
    `${name}\tredBanner=${redBanner}\talert=${alert}\tconfirm=${confirm}\tfiles=${files}`,
  );
}
