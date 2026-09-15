import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['ssh2'],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
