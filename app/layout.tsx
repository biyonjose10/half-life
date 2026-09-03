import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION =
  "Finds published tutorials that went factually stale when the software they teach changed versions, and writes the corrections.";

export const metadata: Metadata = {
  metadataBase: new URL("https://halflife-engine.vercel.app"),
  // The page overrides the title; this is the fallback and the social preview.
  title: "Half-Life",
  description: DESCRIPTION,
  applicationName: "Half-Life",
  // Without these the link renders as a bare URL wherever it is shared - which
  // for a hackathon entry is mostly Devpost, chat and social.
  openGraph: {
    type: "website",
    siteName: "Half-Life",
    title: "Half-Life — tutorial decay engine",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Half-Life — tutorial decay engine",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
