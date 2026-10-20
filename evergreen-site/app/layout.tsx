import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Evergreen — Everyday banking, thoughtfully simple",
  description: "Manage savings, check balances, transfer funds and pay bills with Evergreen demo banking.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
