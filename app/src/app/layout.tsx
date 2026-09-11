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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try { const saved = localStorage.getItem("cat-theme"); const theme = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); document.documentElement.classList.toggle("dark", theme === "dark"); document.documentElement.style.colorScheme = theme; } catch {}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
