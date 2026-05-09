import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-8">
      <div className="w-full rounded-[32px] border border-white/10 bg-slate-950/75 p-10 text-center shadow-[0_24px_120px_rgba(4,11,24,0.6)]">
        <p className="mono text-xs uppercase tracking-[0.32em] text-cyan-200/70">
          CRM Autopilot
        </p>
        <h1 className="mt-4 text-4xl font-semibold text-white">
          Record not found
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-400">
          The requested account or audit run does not exist in the local demo
          data set.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex rounded-full border border-cyan-300/35 bg-cyan-300/12 px-5 py-3 text-sm font-medium text-cyan-50 transition hover:border-cyan-200/70 hover:bg-cyan-300/18"
        >
          Return to dashboard
        </Link>
      </div>
    </main>
  );
}
