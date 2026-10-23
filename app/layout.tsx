import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { PageWaterfall } from "@/components/page-waterfall";
import { appearanceInlineScript } from "@/lib/appearance";
import "./globals.css";
import "./brand.css";
import "./hub.css";
import "./glass.css";
import "./motion.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: { default: "oalab — Dein Client Hub", template: "%s · oalab" },
  description: "Dein Ort für gute Zusammenarbeit. Projekte, nächste Schritte und gemeinsame Ergebnisse im oalab Client Hub.",
  applicationName: "oalab Client Hub",
  icons: { icon: "/brand/oalab-icon.png", shortcut: "/brand/oalab-icon.png", apple: "/brand/oalab-icon.png" },
};

const inter = Inter({
  variable: "--font-inter",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Applies the stored hub appearance before the first paint (no flash on reload). */}
        <script dangerouslySetInnerHTML={{ __html: appearanceInlineScript() }} />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          forcedTheme="light"
          disableTransitionOnChange
        >
          {/* usePathname may suspend while prerendering; the controller renders nothing anyway. */}
          <Suspense fallback={null}><PageWaterfall /></Suspense>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
