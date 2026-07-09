import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // Static export for GitHub Pages (served from https://projectint.github.io/palistor/)
  output: "export",
  basePath: "/palistor",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default withNextIntl(nextConfig);
