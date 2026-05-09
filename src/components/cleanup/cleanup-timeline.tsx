import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  LoaderCircle,
} from "lucide-react";

import type { CleanupTimelineStep } from "@/lib/types";

interface CleanupTimelineProps {
  steps: CleanupTimelineStep[];
  title: string;
  emptyText?: string;
}

export function CleanupTimeline({
  steps,
  title,
  emptyText,
}: CleanupTimelineProps) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
      <div className="border-b border-white/8 pb-5">
        <p className="mono text-xs uppercase tracking-[0.32em] text-cyan-200/70">
          Timeline
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
      </div>

      <div className="mt-6 space-y-4">
        {steps.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
            {emptyText || "No timeline data yet."}
          </div>
        ) : (
          steps.map((step) => {
            const icon =
              step.status === "completed" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              ) : step.status === "active" ? (
                <LoaderCircle className="h-5 w-5 animate-spin text-cyan-200" />
              ) : step.status === "error" ? (
                <AlertTriangle className="h-5 w-5 text-rose-200" />
              ) : (
                <CircleDot className="h-5 w-5 text-slate-500" />
              );

            return (
              <div
                key={step.key}
                className="flex gap-4 rounded-2xl border border-white/6 bg-white/[0.04] p-4"
              >
                <div className="mt-0.5">{icon}</div>
                <div>
                  <div className="font-medium text-white">{step.label}</div>
                  <p className="mt-1 text-sm text-slate-400">
                    {step.note || "Waiting for this stage to begin."}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
