import type { MetadataRoute } from "next";

const SITE_URL = "https://roundfinancial.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /admin = Demo Studio (internal dev tool); /demo = lifecycle
        // orchestrator harness. Neither is end-user surface — exclude
        // from indexing so judges/users land on real routes.
        disallow: ["/admin", "/demo"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
