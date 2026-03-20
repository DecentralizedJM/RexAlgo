import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RexAlgo API",
  description: "Backend API for RexAlgo — use the Vite SPA (frontend/) for the product UI.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
