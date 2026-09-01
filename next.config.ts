import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js dev mode blocks cross-origin requests for its own JS/HMR
  // assets by default — harmless on localhost, but it silently breaks
  // client-side hydration (so buttons render but don't respond) when the
  // dev server is reached via the LAN IP from another device, e.g. testing
  // from a phone on the same WiFi. Only relevant in dev; production builds
  // don't have this restriction.
  allowedDevOrigins: ["192.168.1.185"],
};

export default nextConfig;
