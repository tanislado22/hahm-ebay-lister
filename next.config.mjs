import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project (a stray lockfile elsewhere on the
  // machine would otherwise confuse Next's root detection).
  outputFileTracingRoot: projectRoot,
  // The analyze API receives base64 photos in the request body.
  // Photos are resized in the browser first, but allow generous headroom.
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Content-Security-Policy is set per-request by middleware.ts using a
          // random nonce, so it cannot be a static header here.
        ],
      },
    ];
  },
};

export default nextConfig;
