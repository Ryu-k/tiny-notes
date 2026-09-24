import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Tiny Notes",
  description: "A little space for your next thought.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
