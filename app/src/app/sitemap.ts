import type { MetadataRoute } from "next";

const SITE_URL = "https://roundfinancial.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Public + wallet-gated routes that have unique meta surface. We
  // include the gated ones (e.g. /reputacao, /lab) because the URLs
  // exist with route-specific metadata; Google indexes the URL/meta
  // even when interactive content is behind wallet connect.
  // /admin and /demo are intentionally excluded — covered by robots.ts.
  const routes: Array<{
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  }> = [
    { path: "/",          priority: 1.0, changeFrequency: "weekly" },
    { path: "/lab",       priority: 0.9, changeFrequency: "weekly" },
    { path: "/home",      priority: 0.7, changeFrequency: "weekly" },
    { path: "/grupos",    priority: 0.7, changeFrequency: "weekly" },
    { path: "/reputacao", priority: 0.7, changeFrequency: "weekly" },
    { path: "/mercado",   priority: 0.6, changeFrequency: "weekly" },
    { path: "/insights",  priority: 0.6, changeFrequency: "weekly" },
    { path: "/carteira",  priority: 0.5, changeFrequency: "weekly" },
  ];

  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
