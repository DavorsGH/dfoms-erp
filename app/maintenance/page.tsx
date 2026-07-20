export default function MaintenancePage() {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>
          DFOMS is undergoing scheduled maintenance
        </h1>
        <p style={{ color: "#555" }}>
          We&apos;ll be back shortly. Thank you for your patience.
        </p>
      </div>
    </div>
  );
}
