import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Turbopack: scope module resolution to this directory.
  turbopack: {
    root: path.resolve(__dirname)
  },
  // Build-time file tracing excludes — keep the bundler away from the
  // sibling Expo project and the .NET API (which together contain ~12 GB
  // of node_modules / Android / publish artifacts that have nothing to do
  // with the web app).
  outputFileTracingExcludes: {
    "*": [
      "ArX Task mobile/**",
      "api/**",
      ".expo-export-js/**"
    ]
  },
  // Webpack fallback (used when Turbopack is disabled). The watcher would
  // otherwise scan the 10 GB mobile node_modules folder and freeze the dev
  // server. This `ignored` list keeps the file watcher out of those paths.
  webpack: (config) => {
    config.watchOptions = {
      ...(config.watchOptions ?? {}),
      ignored: [
        "**/node_modules/**",
        "**/ArX Task mobile/**",
        "**/api/**",
        "**/.next/**",
        "**/.git/**"
      ]
    };
    return config;
  }
};

export default nextConfig;
