import { defineConfig } from "vitepress";

// ── Shared SEO constants ───────────────────────────────────────
const SITE_URL = "https://panopticonlabs.ai";
const SITE_TITLE = "Panopticon AI";
const SITE_DESC =
  "Compliance-grade corpus ingestion pipeline. Validate, chunk, watermark, and embed regulatory documents into any Postgres 17 with full sovereignty attribution and tamper-evident provenance.";
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export default defineConfig({
  title: SITE_TITLE,
  description: SITE_DESC,
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,

  sitemap: {
    hostname: SITE_URL,
  },

  head: [
    // ── Favicons ───────────────────────────────────────────────
    [
      "link",
      { rel: "icon", type: "image/svg+xml", href: "/eye-icon.svg" },
    ],
    [
      "link",
      { rel: "apple-touch-icon", sizes: "180x180", href: "/eye-icon.svg" },
    ],

    // ── Canonical ──────────────────────────────────────────────
    ["link", { rel: "canonical", href: SITE_URL }],

    // ── Open Graph ─────────────────────────────────────────────
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: SITE_TITLE }],
    ["meta", { property: "og:title", content: SITE_TITLE }],
    ["meta", { property: "og:description", content: SITE_DESC }],
    ["meta", { property: "og:image", content: OG_IMAGE }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", {
      property: "og:image:alt",
      content: "Panopticon AI — Know Where Every Vector Came From",
    }],
    ["meta", { property: "og:url", content: SITE_URL }],
    ["meta", { property: "og:locale", content: "en_US" }],

    // ── Twitter / X ────────────────────────────────────────────
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:title", content: SITE_TITLE }],
    ["meta", { name: "twitter:description", content: SITE_DESC }],
    ["meta", { name: "twitter:image", content: OG_IMAGE }],
    ["meta", {
      name: "twitter:image:alt",
      content: "Panopticon AI — Know Where Every Vector Came From",
    }],

    // ── SEO Meta ───────────────────────────────────────────────
    [
      "meta",
      {
        name: "keywords",
        content:
          "RAG pipeline, vector database, compliance AI, pgvector, Postgres, GDPR, HIPAA, SOC 2, NIST AI RMF, EU AI Act, corpus ingestion, embedding pipeline, provenance tracking, data sovereignty, watermarking, PostgREST, regulatory AI, AI governance, prompt engineering, CFPO, SIRE, identity-first retrieval, context collapse, deterministic enforcement",
      },
    ],
    ["meta", { name: "author", content: "Panopticon AI" }],
    ["meta", { name: "robots", content: "index, follow" }],
    ["meta", { name: "theme-color", content: "#0f172a" }],

    // ── JSON-LD: SoftwareApplication ───────────────────────────
    [
      "script",
      { type: "application/ld+json" },
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Panopticon AI Corpus Pipeline",
        description: SITE_DESC,
        url: SITE_URL,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Any (Node.js 20+)",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        license: "https://opensource.org/licenses/MIT",
        codeRepository: "https://github.com/Panopticion/corpora-pipeline",
        programmingLanguage: ["TypeScript", "SQL"],
        runtimePlatform: "Node.js",
        softwareRequirements: "Postgres 17, pgvector, PostgREST",
        featureList: [
          "CHECK-constraint attribution enforcement",
          "Cryptographic provenance watermarking",
          "Immutable audit envelopes",
          "Heading-aware semantic chunking",
          "Hybrid vector + full-text search (RRF)",
          "Lease-based concurrent embedding",
          "NIST AI RMF / EU AI Act / DoD compliance mapping",
          "S.I.R.E. identity-first retrieval metadata",
          "MCP server for Claude Desktop and Claude Code",
          "CycloneDX SBOM generation",
        ],
      }),
    ],

    // ── JSON-LD: Organization ──────────────────────────────────
    [
      "script",
      { type: "application/ld+json" },
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Panopticon AI",
        url: SITE_URL,
        logo: `${SITE_URL}/eye-icon.svg`,
        sameAs: ["https://github.com/Panopticion"],
      }),
    ],

    // ── Fonts ──────────────────────────────────────────────────
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    [
      "link",
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
    ],
    [
      "link",
      {
        rel: "stylesheet",
        href:
          "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap",
      },
    ],
  ],

  themeConfig: {
    logo: "/eye-icon.svg",
    siteTitle: "Panopticon AI",

    nav: [
      { text: "Quickstart", link: "/quickstart" },
      { text: "Guide", link: "/guide" },
      { text: "API", link: "/api" },
      { text: "S.I.R.E.", link: "/sire" },
      { text: "MCP", link: "/mcp" },
      { text: "Roadmap", link: "/roadmap" },
      {
        text: "GitHub",
        link: "https://github.com/Panopticion/corpora-pipeline",
      },
    ],

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/Panopticion/corpora-pipeline",
      },
    ],

    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Overview", link: "/" },
          { text: "Quickstart", link: "/quickstart" },
          { text: "Pipeline Guide", link: "/guide" },
          { text: "API Reference", link: "/api" },
        ],
      },
      {
        text: "Architecture",
        items: [
          { text: "S.I.R.E. Identity-First Retrieval", link: "/sire" },
          { text: "MCP Server", link: "/mcp" },
          { text: "Prompt Engineering (CFPO)", link: "/prompt-engineering" },
        ],
      },
      {
        text: "Governance",
        items: [
          { text: "AI Compliance Mapping", link: "/compliance" },
        ],
      },
      {
        text: "Contributors",
        items: [{ text: "Product Roadmap", link: "/roadmap" }],
      },
    ],

    footer: {
      message:
        'Released under the <a href="https://github.com/Panopticion/corpora-pipeline/blob/main/LICENSE">MIT License</a>. Semantic search finds the text — S.I.R.E. enforces the boundary.<br><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="mailto:support@panopticonlabs.ai">support@panopticonlabs.ai</a>',
      copyright: "© 2026 Panopticon AI",
    },

    editLink: {
      pattern:
        "https://github.com/Panopticion/corpora-pipeline/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    search: {
      provider: "local",
    },
  },
});
