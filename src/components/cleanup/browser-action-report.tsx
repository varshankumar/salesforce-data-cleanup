import type { BrowserAction } from "@/lib/types";

interface BrowserActionReportProps {
  actions: BrowserAction[];
}

export function BrowserActionReport({ actions }: BrowserActionReportProps) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
      <div className="border-b border-white/8 pb-5">
        <p className="mono text-xs uppercase tracking-[0.32em] text-cyan-200/70">
          Browser Actions
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">
          Every browser action recorded
        </h2>
      </div>

      <div className="mt-6 space-y-3">
        {actions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
            No browser actions were stored for this run.
          </div>
        ) : (
          actions.map((action, index) => (
            <div
              key={`${action.timestamp}-${index}`}
              className="rounded-2xl border border-white/8 bg-white/[0.04] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
                <span className="uppercase tracking-[0.2em]">
                  {action.scope}
                </span>
                <span>{new Date(action.timestamp).toLocaleString()}</span>
              </div>
              <div className="mt-2 text-sm font-medium text-white">
                {action.action}
              </div>
              {action.details ? (
                <div className="mt-2 text-sm text-slate-300">
                  {action.details}
                </div>
              ) : null}
              {action.url ? (
                <div className="mt-2 break-all text-sm text-cyan-100">
                  {action.url}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
