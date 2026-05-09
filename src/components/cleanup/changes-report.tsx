import type { FieldChange } from "@/lib/types";
import {
  confidenceToPercent,
  formatDisplayValue,
  formatFieldLabel,
} from "@/lib/utils";

interface ChangesReportProps {
  changes: FieldChange[];
}

export function ChangesReport({ changes }: ChangesReportProps) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
      <div className="border-b border-white/8 pb-5">
        <p className="mono text-xs uppercase tracking-[0.32em] text-cyan-200/70">
          Change Report
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">
          What the agent changed
        </h2>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-white/8">
        <table className="min-w-full">
          <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-[0.22em] text-slate-400">
            <tr>
              <th className="px-4 py-4 font-medium">Field</th>
              <th className="px-4 py-4 font-medium">Before</th>
              <th className="px-4 py-4 font-medium">Proposed</th>
              <th className="px-4 py-4 font-medium">Final</th>
              <th className="px-4 py-4 font-medium">Confidence</th>
              <th className="px-4 py-4 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/6">
            {changes.map((change) => (
              <tr key={change.field} className="bg-transparent">
                <td className="px-4 py-5 align-top text-sm font-medium text-white">
                  {formatFieldLabel(change.field)}
                </td>
                <td className="px-4 py-5 align-top text-sm text-slate-400">
                  {formatDisplayValue(change.oldValue)}
                </td>
                <td className="px-4 py-5 align-top text-sm text-cyan-100">
                  {formatDisplayValue(change.proposedValue)}
                </td>
                <td className="px-4 py-5 align-top text-sm text-white">
                  {formatDisplayValue(change.finalValue || change.oldValue)}
                </td>
                <td className="px-4 py-5 align-top text-sm text-slate-300">
                  {confidenceToPercent(change.confidence)}
                </td>
                <td className="px-4 py-5 align-top text-sm text-slate-400">
                  <div className="font-medium text-white">{change.status}</div>
                  <div className="mt-2 leading-6">{change.statusNote}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
