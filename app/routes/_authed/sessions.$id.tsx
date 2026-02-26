import { createFileRoute } from "@tanstack/react-router";
import { getSessionWithDocuments } from "@/server/session-actions";
import { CorpusWorkspace } from "@/components/CorpusWorkspace";

const SITE_URL = "https://panopticonlabs.ai";

export const Route = createFileRoute("/_authed/sessions/$id")({
  loader: ({ params }) =>
    getSessionWithDocuments({ data: { sessionId: params.id } }),
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.session?.name ?? "Session"} — Panopticon AI` },
    ],
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
              name: "Sessions",
              item: `${SITE_URL}/sessions`,
            },
            {
              "@type": "ListItem",
              position: 3,
              name: loaderData?.session?.name ?? "Session",
            },
          ],
        }),
      },
    ],
  }),
  component: SessionWorkspacePage,
});

function SessionWorkspacePage() {
  const { session, documents } = Route.useLoaderData();

  return (
    <CorpusWorkspace
      session={session}
      documents={documents}
    />
  );
}
