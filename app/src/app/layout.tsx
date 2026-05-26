import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAT Mock Generator",
  description:
    "Generate fresh CAT-style VARC, DILR and QA problem sets from past mocks.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
