import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fan Offer Engine",
  description: "Cart win-back offers for marketer review",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
