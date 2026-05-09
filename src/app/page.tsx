import Link from "next/link";
import { ArrowUpRight, DatabaseZap } from "lucide-react";

import { CleanupLauncher } from "@/components/cleanup/cleanup-launcher";
import { getKernelIntegrationNote } from "@/lib/agents/kernel";
import {
  getNorthstarIntegrationNote,
  hasNorthstarConfig,
} from "@/lib/agents/lightcone";
import { hasKernelConfig } from "@/lib/agents/kernel";
import { hasSalesforceBrowserConfig } from "@/lib/agents/salesforce";
import { getLatestCleanupRun } from "@/lib/data/store";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [latestRun] = await Promise.all([getLatestCleanupRun()]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-8 md:px-8 lg:px-10">
      <CleanupLauncher
        cleanupReady={
          hasSalesforceBrowserConfig() && hasKernelConfig() && hasNorthstarConfig()
        }
        kernelNote={getKernelIntegrationNote()}
        northstarNote={getNorthstarIntegrationNote()}
      />

      <section className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mono text-xs uppercase tracking-[0.32em] text-cyan-200/70">
              Latest Run
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Most recent cleanup report
            </h2>
          </div>
        </div>

        {latestRun ? (
          <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/[0.04] p-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <div className="text-sm font-medium text-white">
                {latestRun.status === "completed"
                  ? "Cleanup completed"
                  : "Cleanup failed"}
              </div>
              <div className="text-sm text-slate-400">
                {formatDateTime(latestRun.completedAt)}
              </div>
              <div className="text-sm leading-6 text-slate-300">
                {latestRun.summary}
              </div>
            </div>
            <Link
              href={`/runs/${latestRun.id}`}
              className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/12 px-5 py-3 text-sm font-medium text-cyan-50 transition hover:border-cyan-200/70 hover:bg-cyan-300/18"
            >
              Open report
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
            No cleanup run has been recorded yet. Start the first Salesforce
            cleanup from the button above.
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
          <div className="flex items-start gap-3">
            <DatabaseZap className="mt-0.5 h-5 w-5 text-cyan-100" />
            <div>
              <div className="text-sm font-medium text-white">
                Data source
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                The app no longer uses seeded CRM records. It reads the Account
                record directly from the configured Salesforce URL at runtime.
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
          <div className="flex items-start gap-3">
            <DatabaseZap className="mt-0.5 h-5 w-5 text-cyan-100" />
            <div>
              <div className="text-sm font-medium text-white">
                Writeback
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                The agent opens the Salesforce edit form, fills the discovered
                updates, saves the record, and verifies the final state before
                the report is stored.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
