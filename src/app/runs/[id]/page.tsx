import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronLeft,
  RefreshCw,
} from "lucide-react";

import { ChangesReport } from "@/components/cleanup/changes-report";
import { CleanupTimeline } from "@/components/cleanup/cleanup-timeline";
import { BrowserActionReport } from "@/components/cleanup/browser-action-report";
import { EvidenceGrid } from "@/components/cleanup/evidence-grid";
import { SnapshotPanel } from "@/components/cleanup/snapshot-panel";
import { getCleanupRunById } from "@/lib/data/store";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CleanupRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await getCleanupRunById(id);

  if (!run) {
    notFound();
  }

  const appliedCount = run.changes.filter(
    (change) => change.status === "applied",
  ).length;

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-6 py-8 md:px-8 lg:px-10">
      <div className="space-y-8">
        <div className="rounded-[36px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(92,214,255,0.16),transparent_36%),linear-gradient(145deg,rgba(10,19,35,0.95),rgba(5,11,22,0.95))] p-8 shadow-[0_28px_120px_rgba(3,8,18,0.72)]">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to launcher
          </Link>

          <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs uppercase tracking-[0.24em] ${
                  run.status === "completed"
                    ? "border border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                    : "border border-rose-300/20 bg-rose-300/10 text-rose-100"
                }`}
              >
                {run.status === "completed" ? "Cleanup completed" : "Cleanup failed"}
              </div>
              <h1 className="mt-5 text-4xl font-semibold text-white">
                Salesforce cleanup report
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-300">
                {run.summary}
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/6 p-5">
              <div className="text-sm text-slate-300">Completed at</div>
              <div className="mt-2 text-lg font-medium text-white">
                {formatDateTime(run.completedAt)}
              </div>
              <div className="mt-3 text-sm text-slate-400">
                {appliedCount} field change{appliedCount === 1 ? "" : "s"} applied
              </div>
            </div>
          </div>

          {run.errorMessage ? (
            <div className="mt-6 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <span>{run.errorMessage}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-8 xl:grid-cols-2">
          <SnapshotPanel title="Before cleanup" snapshot={run.before} />
          <SnapshotPanel title="After cleanup" snapshot={run.after} />
        </div>

        <ChangesReport changes={run.changes} />
        <EvidenceGrid evidence={run.evidence} />
        <BrowserActionReport actions={run.browserActions || []} />
        <CleanupTimeline
          steps={run.steps}
          title="Cleanup execution timeline"
          emptyText="No execution timeline was stored for this run."
        />

        <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
          <div className="border-b border-white/8 pb-5">
            <p className="mono text-xs uppercase tracking-[0.32em] text-cyan-200/70">
              Artifacts
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Browser session outputs
            </h2>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">
                Salesforce record
              </div>
              <a
                href={run.salesforceRecordUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-2 text-sm text-cyan-100 hover:text-cyan-50"
              >
                Open configured record
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">
                Browser artifact
              </div>
              <div className="mt-2 text-sm text-white">
                {run.session.replayUrl ||
                  run.session.liveUrl ||
                  run.session.tracePath ||
                  "No browser artifact recorded"}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/12"
            >
              <RefreshCw className="h-4 w-4" />
              Run another cleanup
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
