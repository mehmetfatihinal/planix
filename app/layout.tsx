import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth-state";
import { AppDataProvider } from "@/lib/app-state";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Planix",
  description: "Planix — smart business assistant for tasks, offers, invoices, documents, and field work.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/planix-logo.png", type: "image/png" }
    ],
    shortcut: "/planix-logo.png",
    apple: "/planix-logo.png"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" data-scroll-behavior="smooth">
      <body>
        <AuthProvider>
          <AppDataProvider>
            <AppShell>{children}</AppShell>
          </AppDataProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
