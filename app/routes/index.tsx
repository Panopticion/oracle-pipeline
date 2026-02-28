import { createFileRoute, Link } from "@tanstack/react-router";
import { getUser } from "@/server/session-actions";

const PIPELINE_GITHUB_URL = "https://github.com/Panopticion/corpus-pipeline-cli";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const user = await getUser();
    return { user };
  },
  component: LandingPage,
});

function LandingPage() {
  const { user } = Route.useRouteContext();
  const isAuthed = user?.authenticated;

  return (
    <div className="min-h-screen bg-[#0f172a] text-white font-[Inter,system-ui,sans-serif]">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5 rounded-md px-1 py-0.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-sm font-semibold text-white">
            P
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight text-white">Panopticon</span>
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">Corpus Pipeline</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={PIPELINE_GITHUB_URL}
            className="text-sm text-slate-400 hover:text-white transition"
          >
            GitHub
          </a>
          {isAuthed ? (
            <Link
              to="/sessions"
              className="text-sm px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 transition font-medium"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/auth/login"
                className="text-sm text-slate-300 hover:text-white transition font-medium"
              >
                Sign in
              </Link>
              <Link
                to="/auth/signup"
                className="text-sm px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 transition font-medium"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-24 pb-16 max-w-4xl mx-auto text-center">
        <p className="text-blue-400 text-sm font-medium tracking-wide uppercase mb-4">
          Compliance-Grade AI Parsing
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold leading-tight mb-6">
          Upload compliance docs.
          <br />
          <span className="text-blue-400">Get attributed vectors + crosswalk.</span>
        </h1>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
          AI-parse regulatory documents into structured corpus Markdown with S.I.R.E.
          identity metadata, chunk and watermark for provenance, generate cross-framework
          crosswalks, and download attribution-ready bundles. Human-in-the-loop at every step.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            to="/auth/signup"
            className="px-6 py-3 rounded-md bg-blue-600 hover:bg-blue-500 transition font-medium text-sm"
          >
            Get started free
          </Link>
          <a
            href={PIPELINE_GITHUB_URL}
            className="px-6 py-3 rounded-md border border-slate-600 hover:border-slate-400 transition font-medium text-sm text-slate-300"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-20 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-12">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              step: "1",
              title: "Upload & Parse",
              desc: "Paste text or upload .txt/.md/.json/.yaml/.pdf/.docx files. AI converts raw compliance text into structured corpus Markdown with S.I.R.E. identity metadata.",
            },
            {
              step: "2",
              title: "Review & Edit",
              desc: "Review every AI-generated parse. Edit the Markdown directly. Nothing moves forward without your approval.",
            },
            {
              step: "3",
              title: "Chunk & Watermark",
              desc: "Split documents into semantic sections. Each chunk gets a cryptographic provenance watermark before export.",
            },
            {
              step: "4",
              title: "Crosswalk",
              desc: "AI maps equivalent controls, overlapping requirements, and gaps across all your uploaded frameworks.",
            },
            {
              step: "5",
              title: "Download",
              desc: "Download the full bundle — parsed documents, watermarked chunks, crosswalk, and README — as a ZIP.",
            },
            {
              step: "6",
              title: "Share",
              desc: "Make sessions public with a shareable link. Read-only access for reviewers, auditors, and stakeholders.",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="bg-slate-800/50 border border-slate-700 rounded-lg p-6"
            >
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center mb-4">
                {item.step}
              </div>
              <h3 className="font-semibold mb-2">{item.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20 max-w-5xl mx-auto border-t border-slate-800">
        <h2 className="text-2xl font-bold text-center mb-4">Built for regulated industries</h2>
        <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
          Every feature exists because compliance teams need provenance, not promises.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              title: "S.I.R.E. Identity Enforcement",
              desc: "Subject, Included, Relevant, Excluded — deterministic post-retrieval gates that prevent jurisdictional context collapse.",
            },
            {
              title: "CFPO Prompt Architecture",
              desc: "Content, Format, Policy, Output — structured prompts that produce consistent, auditable corpus Markdown.",
            },
            {
              title: "Cross-Framework Crosswalks",
              desc: "AI maps controls across GDPR, HIPAA, SOC 2, ISO 27001, and more. One upload session, unified mapping.",
            },
            {
              title: "Human-in-the-Loop",
              desc: "Review and edit every AI-generated parse and crosswalk before it becomes part of your corpus.",
            },
            {
              title: "Provenance Watermarking",
              desc: "Every chunk gets a cryptographic signature. Export anywhere — the watermark travels with the data.",
            },
            {
              title: "Any Postgres 17",
              desc: "Supabase, Crunchy Bridge, RDS, Cloud SQL, bare metal — anywhere pgvector runs. Your database, your data.",
            },
          ].map((feat) => (
            <div
              key={feat.title}
              className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-5"
            >
              <h3 className="font-semibold text-sm mb-2">{feat.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Open Source CTA */}
      <section className="px-6 py-16 max-w-4xl mx-auto text-center border-t border-slate-800">
        <h2 className="text-xl font-bold mb-3">Open-source pipeline tools</h2>
        <p className="text-slate-400 text-sm mb-6 max-w-xl mx-auto leading-relaxed">
          The core pipeline — validate, chunk, watermark, embed, and crosswalk — is
          open source. Run the CLI, MCP server, or job worker anywhere, including
          air-gapped SCIF environments.
        </p>
        <div className="flex items-center justify-center gap-4">
          <a
            href={PIPELINE_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 rounded-md border border-slate-600 hover:border-slate-400 transition font-medium text-sm text-slate-300"
          >
            View on GitHub
          </a>
        </div>
        <p className="mt-6 text-xs text-slate-500">
          <code className="bg-slate-800 px-2 py-1 rounded text-slate-400">npx tsx src/worker.ts</code>
          {" "}
          <code className="bg-slate-800 px-2 py-1 rounded text-slate-400">npx tsx src/cli.ts --action validate</code>
        </p>
      </section>

      {/* Footer */}
      <footer className="px-6 py-10 border-t border-slate-800">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            &copy; {new Date().getFullYear()} Panopticon AI. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <a
              href="https://panopticonlabs.ai/privacy"
              className="text-xs text-slate-500 hover:text-slate-300 transition"
            >
              Privacy
            </a>
            <a
              href="https://panopticonlabs.ai/terms"
              className="text-xs text-slate-500 hover:text-slate-300 transition"
            >
              Terms
            </a>
            <a
              href={PIPELINE_GITHUB_URL}
              className="text-xs text-slate-500 hover:text-slate-300 transition"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
