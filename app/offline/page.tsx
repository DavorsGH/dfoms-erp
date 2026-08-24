export const dynamic = "force-static";

const AVAILABLE_OFFLINE = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/hr-payroll/attendance", label: "Attendance Register" },
  { href: "/dashboard/finance/expenses", label: "Expense Register" },
] as const;

/**
 * Offline shell precached by the service worker.
 *
 * Styling is fully inline (no Tailwind / hashed CSS chunks) so the branded
 * look always renders when this HTML is served offline — independent of
 * Next.js CSS filename hashes between builds.
 *
 * Uses plain <img> and <a> so assets/nav hit SW-preached paths / full navigations.
 */
export default function OfflinePage() {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            html, body {
              margin: 0;
              padding: 0;
              min-height: 100%;
              background-color: #0F2744;
            }
          `,
        }}
      />
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0F2744",
          paddingLeft: 16,
          paddingRight: 16,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 28 * 16,
            borderRadius: 8,
            border: "1px solid #e4e4e7",
            backgroundColor: "#ffffff",
            padding: 32,
            textAlign: "center",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              marginBottom: 16,
              display: "flex",
              justifyContent: "center",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- raw /icons path for SW precache */}
            <img
              src="/icons/apple-touch-icon-180x180.png"
              alt="Davors Facilities"
              width={64}
              height={64}
              style={{ width: 64, height: 64, display: "block" }}
            />
          </div>
          <h1
            style={{
              margin: "0 0 8px",
              fontSize: 20,
              fontWeight: 600,
              lineHeight: 1.4,
              color: "#18181b",
            }}
          >
            You are offline
          </h1>
          <p
            style={{
              margin: "0 0 16px",
              fontSize: 14,
              lineHeight: 1.5,
              color: "#52525b",
            }}
          >
            Your session stays active. These pages are available offline; other
            routes need a connection.
          </p>
          <ul
            style={{
              margin: "0 0 24px",
              padding: 0,
              listStyle: "none",
              textAlign: "left",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {AVAILABLE_OFFLINE.map((item) => (
              <li key={item.href} style={{ marginBottom: 8 }}>
                <a
                  href={item.href}
                  style={{
                    fontWeight: 500,
                    color: "#18181b",
                    textDecoration: "underline",
                  }}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.5,
              color: "#52525b",
            }}
          >
            <a
              href="/dashboard"
              style={{
                fontWeight: 500,
                color: "#18181b",
                textDecoration: "underline",
              }}
            >
              Try again
            </a>
          </p>
        </div>
      </div>
    </>
  );
}
