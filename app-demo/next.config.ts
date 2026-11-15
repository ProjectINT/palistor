import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// The library comes from source through tsconfig paths. By default they point
// at the package entry (the Cube core); PALISTOR_IMPL=store switches to the
// store reference implementation, in its own build dir so both dev servers
// can run side by side (experiments/CubePlan.md, Phase 3).
const onStore = process.env.PALISTOR_IMPL === "store";

const nextConfig: NextConfig = {
  ...(onStore && { distDir: ".next-store", typescript: { tsconfigPath: "tsconfig.store.json" } }),
  // Static export for GitHub Pages (served from https://projectint.github.io/palistor/)
  output: "export",
  basePath: "/palistor",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default withNextIntl(nextConfig);
