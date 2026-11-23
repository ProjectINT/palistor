import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// The library comes from source through tsconfig paths. By default they point
// at the package entry (the Cube core); PALISTOR_IMPL=store switches to the
// store reference implementation, in its own build dir so both dev servers
// can run side by side (experiments/CubePlan.md, Phase 3).
const onStore = process.env.PALISTOR_IMPL === "store";

// Routes that need Cube-only APIs are named `page.cube.tsx`: the extra page
// extension is registered only on Cube, so on store the file is not a route
// (and tsconfig.store.json keeps it out of the type-check). `pageExtensions`
// replaces Next's default list, hence the defaults are repeated.
const DEFAULT_PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];

const nextConfig: NextConfig = {
  ...(onStore && { distDir: ".next-store", typescript: { tsconfigPath: "tsconfig.store.json" } }),
  pageExtensions: onStore ? DEFAULT_PAGE_EXTENSIONS : ["cube.tsx", ...DEFAULT_PAGE_EXTENSIONS],
  // Inlined at build time: the home page links to the Cube-only /ssr route when it is "1".
  env: { NEXT_PUBLIC_PALISTOR_SSR_DEMO: onStore ? "" : "1" },
  // Static export for GitHub Pages (served from https://projectint.github.io/palistor/)
  output: "export",
  basePath: "/palistor",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default withNextIntl(nextConfig);
