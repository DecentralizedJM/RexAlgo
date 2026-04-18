import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "pg-native"],
  output: "standalone",
};

export default nextConfig;
