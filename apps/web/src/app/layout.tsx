import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LocalScan | Find local businesses",
  description: "Discover and assess local businesses by ZIP code.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
