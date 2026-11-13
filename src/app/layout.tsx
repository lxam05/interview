import type { Metadata } from "next";
import { Instrument_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const ui = Instrument_Sans({ variable: "--font-ui", subsets: ["latin"] });
const reading = Source_Serif_4({ variable: "--font-reading", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Internship interview prep for Ireland",
    template: "%s | Internship interview prep",
  },
  description:
    "Know what to study before your tech internship interview in Ireland. Every topic is ranked by evidence and linked to its sources.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IE" className={`${ui.variable} ${reading.variable} antialiased`}>
      <body className="min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}
