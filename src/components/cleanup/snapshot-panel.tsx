import type { SalesforceAccountSnapshot } from "@/lib/types";
import { formatDisplayValue } from "@/lib/utils";

interface SnapshotPanelProps {
  title: string;
  snapshot: SalesforceAccountSnapshot | null;
}

export function SnapshotPanel({ title, snapshot }: SnapshotPanelProps) {
  const entries = snapshot
    ? [
        ["Company Name", snapshot.companyName],
        ["Website", snapshot.website],
        ["Billing Address", snapshot.billingAddress],
        ["Phone Number", snapshot.phoneNumber],
        ["Employee Count", snapshot.employeeCount],
        ["Primary Contact", snapshot.primaryContactName],
        ["Contact Title", snapshot.primaryContactTitle],
        ["Contact Email", snapshot.primaryContactEmail],
      ]
    : [];

  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
      <div className="border-b border-white/8 pb-5">
        <p className="mono text-xs uppercase tracking-[0.32em] text-cyan-200/70">
          Salesforce Snapshot
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
      </div>

      {snapshot ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {entries.map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl border border-white/8 bg-white/[0.04] p-4"
            >
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">
                {label}
              </div>
              <div className="mt-2 text-sm text-white">
                {formatDisplayValue(value)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
          No Salesforce snapshot was captured for this run.
        </div>
      )}
    </div>
  );
}
