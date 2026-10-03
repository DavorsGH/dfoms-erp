import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { resolvePublicSiteUrl } from "@/utils/public-site-url";
import ServiceWorkerRegistrar from "./service-worker-registrar";
import "./globals.css";
import "./financial-statement-table.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0F2744",
};

const portalSiteUrl = resolvePublicSiteUrl();

export const metadata: Metadata = {
  title: {
    default: "DavSuite",
    template: "DavSuite — %s",
  },
  description: "DavSuite enterprise management platform",
  applicationName: "DavSuite",
  manifest: "/manifest.json",
  metadataBase: new URL(portalSiteUrl),
  openGraph: {
    title: "DavSuite",
    description: "DavSuite enterprise management platform",
    url: portalSiteUrl,
    siteName: "DavSuite",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DavSuite",
    description: "DavSuite enterprise management platform",
  },
  appleWebApp: {
    capable: true,
    title: "DavSuite",
    statusBarStyle: "default",
  },
  // Next emits mobile-web-app-capable from appleWebApp.capable; older Safari
  // still looks for the apple-prefixed tag.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon-180x180.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-x-hidden antialiased`}
    >
      <body className="flex min-h-full flex-col overflow-x-hidden">
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
