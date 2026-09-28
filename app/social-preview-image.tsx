import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const socialPreviewAlt = "Davors Technologies ERP";
export const socialPreviewSize = { width: 1200, height: 630 };
export const socialPreviewContentType = "image/png";

const NAVY = "#0f2744";
const SUBTITLE = "#9fb2c9";

async function loadLogoDataUrl(): Promise<string> {
  const logoBytes = await readFile(join(process.cwd(), "public", "logo.jpg"));
  return `data:image/jpeg;base64,${logoBytes.toString("base64")}`;
}

/** Shared 1200×630 link-preview image (Open Graph / Twitter). */
export async function renderSocialPreviewImage() {
  const logoSrc = await loadLogoDataUrl();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          backgroundColor: NAVY,
          paddingTop: 108,
        }}
      >
        <img
          src={logoSrc}
          width={240}
          height={240}
          alt=""
          style={{ objectFit: "contain" }}
        />
        <div
          style={{
            marginTop: 52,
            color: "#ffffff",
            fontSize: 42,
            fontWeight: 700,
            letterSpacing: 2,
            fontFamily: "Arial, Helvetica, sans-serif",
            textAlign: "center",
            paddingLeft: 48,
            paddingRight: 48,
          }}
        >
          DAVORS TECHNOLOGIES ERP
        </div>
        <div
          style={{
            marginTop: 8,
            color: SUBTITLE,
            fontSize: 24,
            fontWeight: 400,
            fontFamily: "Arial, Helvetica, sans-serif",
            textAlign: "center",
            paddingLeft: 48,
            paddingRight: 48,
          }}
        >
          Davors Technologies Ltd
        </div>
      </div>
    ),
    {
      ...socialPreviewSize,
    },
  );
}
