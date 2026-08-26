"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const ROLE_STORAGE_KEY = "dfoms_portal_last_role";
const EXPANDED_STORAGE_KEY = "dfoms_portal_pm_expanded";

type PortalRole = "landlord" | "tenant" | "facility_manager";

const cardClassName =
  "flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm";

const primaryButtonClassName =
  "inline-flex w-full items-center justify-center rounded-md bg-[#0f2744] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]";

const signUpLinkClassName =
  "font-semibold text-[#0f2744] underline underline-offset-2 transition-colors hover:text-[#1a3a5c]";

const signUpPromptClassName =
  "flex flex-col items-center gap-0.5 text-center text-sm text-slate-600";

const ROLES: Array<{
  id: PortalRole;
  chipLabel: string;
  loginHref: string;
}> = [
  {
    id: "landlord",
    chipLabel: "Landlord",
    loginHref: "/landlord-portal/login",
  },
  {
    id: "tenant",
    chipLabel: "Tenant",
    loginHref: "/portal/login",
  },
  {
    id: "facility_manager",
    chipLabel: "Facility Manager",
    loginHref: "/facility-portal/login",
  },
];

function isPortalRole(value: string | null): value is PortalRole {
  return value === "landlord" || value === "tenant" || value === "facility_manager";
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={`h-5 w-5 shrink-0 text-slate-300 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function RoleSecondaryLine({ roleId }: { roleId: PortalRole }) {
  if (roleId === "landlord") {
    return (
      <div className={signUpPromptClassName}>
        <span>New landlord?</span>
        <Link href="/landlord-portal/signup" className={signUpLinkClassName}>
          Sign Up
        </Link>
      </div>
    );
  }

  return (
    <p className="text-center text-xs text-slate-500">
      Your landlord will send you an invite.
    </p>
  );
}

/** Mobile-only Property Management accordion + role chips. */
export default function PortalPropertyManagementMobile() {
  const [expanded, setExpanded] = useState(false);
  const [selectedRole, setSelectedRole] = useState<PortalRole>("landlord");

  useEffect(() => {
    const storedRole = localStorage.getItem(ROLE_STORAGE_KEY);
    const storedExpanded = localStorage.getItem(EXPANDED_STORAGE_KEY);

    if (isPortalRole(storedRole)) {
      setSelectedRole(storedRole);
      setExpanded(true);
      return;
    }

    if (storedExpanded === "true") {
      setExpanded(true);
    }
  }, []);

  function persistExpanded(next: boolean) {
    setExpanded(next);
    localStorage.setItem(EXPANDED_STORAGE_KEY, next ? "true" : "false");
  }

  function selectRole(role: PortalRole) {
    setSelectedRole(role);
    localStorage.setItem(ROLE_STORAGE_KEY, role);
    if (!expanded) {
      persistExpanded(true);
    }
  }

  function toggleExpanded() {
    persistExpanded(!expanded);
  }

  const activeRole =
    ROLES.find((role) => role.id === selectedRole) ?? ROLES[0];

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-600/40 bg-slate-900/20 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-300 sm:text-sm"
      >
        <span>Property Management</span>
        <ChevronIcon expanded={expanded} />
      </button>

      {expanded ? (
        <div className="space-y-4">
          <div
            className="grid grid-cols-3 gap-2 rounded-lg border border-slate-600/30 bg-slate-900/10 p-1"
            role="tablist"
            aria-label="Property management portal role"
          >
            {ROLES.map((role) => {
              const selected = role.id === selectedRole;
              return (
                <button
                  key={role.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectRole(role.id)}
                  className={`rounded-md px-2 py-2 text-center text-xs font-medium leading-tight transition-colors sm:text-sm ${
                    selected
                      ? "bg-white text-[#0f2744] shadow-sm"
                      : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  {role.chipLabel}
                </button>
              );
            })}
          </div>

          <div
            className={`${cardClassName} p-5`}
            role="tabpanel"
            aria-label={activeRole.chipLabel}
          >
            <div className="space-y-3">
              <Link href={activeRole.loginHref} className={primaryButtonClassName}>
                Log In
              </Link>
              <RoleSecondaryLine roleId={activeRole.id} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
