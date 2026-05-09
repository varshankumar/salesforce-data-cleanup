import { ExternalLink } from "lucide-react";

import type { SourceEvidence } from "@/lib/types";
import {
  confidenceToPercent,
  confidenceTone,
  formatFieldLabel,
} from "@/lib/utils";

interface EvidenceGridProps {
  evidence: SourceEvidence[];
}

export function EvidenceGrid({ evidence }: EvidenceGridProps) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
      <div className="border-b border-white/8 pb-5">
        <p className="mono text-xs uppercase tracking-[0.32em] text-cyan-200/70">
          Public Evidence
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">
          Sources consulted during cleanup
        </h2>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {evidence.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
            No public evidence was stored for this run.
          </div>
        ) : (
          evidence.map((item, index) => {
            const tone = confidenceTone(item.confidence);

            return (
              <div
                key={`${item.url}-${index}`}
                className="rounded-2xl border border-white/8 bg-white/[0.04] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-white">
                      {item.title}
                    </div>
                    <div className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-400">
                      Supports {formatFieldLabel(item.fieldSupported)}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      tone === "high"
                        ? "bg-emerald-400/12 text-emerald-200"
                        : tone === "medium"
                          ? "bg-amber-300/12 text-amber-100"
                          : "bg-rose-300/12 text-rose-100"
                    }`}
                  >
                    {confidenceToPercent(item.confidence)}
                  </span>
                </div>

                <p className="mt-4 text-sm leading-6 text-slate-300">
                  {item.extractedText}
                </p>
                <p className="mt-3 text-sm text-slate-400">{item.notes}</p>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex items-center gap-2 text-sm text-cyan-100 hover:text-cyan-50"
                >
                  Open source
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
