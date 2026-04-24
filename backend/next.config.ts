import type { NextConfig } from "next";

/**
 * `bodySizeLimit` only covers Server Actions — route handlers must check the
 * `Content-Length` header explicitly (see `src/lib/bodyLimit.ts`). Set it
 * here anyway so a future Server Action boundary inherits the same cap.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "pg-native"],
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: "512kb",
    },
  },
};

export default nextConfig;
