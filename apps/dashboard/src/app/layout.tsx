import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bidstream Arena",
  description: "Live autonomous AdTech optimization with and without organizational memory",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
