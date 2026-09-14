import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aura SRE - AI Incident Reporting & RCA Monitor",
  description: "AI-driven real-time server telemetry monitoring, anomaly detection, and automated root cause analysis.",
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
