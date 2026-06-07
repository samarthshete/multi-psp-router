import type { Metadata } from "next";
import "@adyen/adyen-web/styles/adyen.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "multi-psp-router",
  description: "Payment service provider routing workspace"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
