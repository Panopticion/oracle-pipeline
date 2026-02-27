import { createFileRoute } from "@tanstack/react-router";
import { getEncyclopedia } from "@/server/session-actions";
import { EncyclopediaPage } from "@/components/EncyclopediaPage";

const SITE_URL = "https://panopticonlabs.ai";

export const Route = createFileRoute("/_authed/encyclopedia/")({
  loader: () => getEncyclopedia(),
  head: () => ({
    meta: [{ title: "Encyclopedia — Panopticon AI" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "Home",
              item: SITE_URL,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: "Encyclopedia",
            },
          ],
        }),
      },
    ],
  }),
  component: EncyclopediaRoute,
});

function EncyclopediaRoute() {
  const entries = Route.useLoaderData();
  return <EncyclopediaPage serverEntries={entries} />;
}
