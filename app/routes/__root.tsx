import {
  HeadContent,
  Outlet,
  Scripts,
  ScrollRestoration,
  createRootRoute,
} from "@tanstack/react-router";
import appCss from "@/styles/app.css?url";

const SITE_URL = "https://panopticonlabs.ai";
const TITLE = "Panopticon AI — Corpus Pipeline";
const DESC =
  "Upload compliance documents, AI-parse into structured corpus Markdown, generate cross-framework crosswalks, and download attributed vector-ready bundles. Sign in to start.";
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE },

      // SEO
      { name: "description", content: DESC },
      {
        name: "keywords",
        content:
          "compliance AI, corpus pipeline, document parsing, crosswalk mapping, RAG pipeline, vector database, pgvector, GDPR, HIPAA, SOC 2, SIRE, identity-first retrieval, regulatory AI, AI governance, Panopticon",
      },
      { name: "author", content: "Panopticon AI" },
      { name: "robots", content: "index, follow" },
      { name: "theme-color", content: "#0f172a" },

      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Panopticon AI" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content: "Panopticon AI — Know Where Every Vector Came From",
      },
      { property: "og:url", content: SITE_URL },
      { property: "og:locale", content: "en_US" },

      // Twitter / X
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: OG_IMAGE },
      {
        name: "twitter:image:alt",
        content: "Panopticon AI — Know Where Every Vector Came From",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: `${SITE_URL}/eye-icon.svg` },
      { rel: "canonical", href: SITE_URL },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-surface text-text antialiased font-[Inter,system-ui,sans-serif]">
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
