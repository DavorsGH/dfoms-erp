import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ServiceWorkerRegistrar from "./service-worker-registrar";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Davors Facilities ERP",
  description: "Davors Facilities Management Services Ltd ERP System",
  manifest: "/manifest.json",
  metadataBase: new URL("https://portal.davorsfacilities.com"),
  openGraph: {
    title: "Davors Facilities ERP",
    description: "Davors Facilities Management Services Ltd ERP System",
    url: "https://portal.davorsfacilities.com",
    siteName: "Davors Facilities ERP",
    images: [
      {
        url: "https://portal.davorsfacilities.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "Davors Facilities ERP",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Davors Facilities ERP",
    description: "Davors Facilities Management Services Ltd ERP System",
    images: ["https://portal.davorsfacilities.com/og-image.png"],
  },
  appleWebApp: {
    capable: true,
    title: "Davors ERP",
    statusBarStyle: "default",
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
