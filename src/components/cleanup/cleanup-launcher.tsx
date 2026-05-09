"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Play, ShieldCheck, Sparkles } from "lucide-react";

import { CleanupTimeline } from "@/components/cleanup/cleanup-timeline";
import type {
  CleanupRun,
  CleanupTimelineStep,
  LoginChallenge,
} from "@/lib/types";

const initialSteps: CleanupTimelineStep[] = [
  {
    key: "opening-browser",
    label: "Opening browser session",
    status: "pending",
  },
  {
    key: "signing-into-salesforce",
    label: "Signing into Salesforce",
    status: "pending",
  },
  {
    key: "reading-salesforce-record",
    label: "Reading Salesforce record",
    status: "pending",
  },
  {
    key: "researching-public-web",
    label: "Researching public web",
    status: "pending",
  },
  {
    key: "comparing-evidence",
    label: "Comparing evidence",
    status: "pending",
  },
  {
    key: "updating-salesforce",
    label: "Updating Salesforce",
    status: "pending",
  },
  {
    key: "verifying-record",
    label: "Verifying record",
    status: "pending",
  },
  {
    key: "writing-report",
    label: "Writing report",
    status: "pending",
  },
];

interface CleanupLauncherProps {
  cleanupReady: boolean;
  kernelNote: string;
  northstarNote: string;
}

export function CleanupLauncher({
  cleanupReady,
  kernelNote,
  northstarNote,
}: CleanupLauncherProps) {
  const router = useRouter();
  const eventSourceRef = useRef<EventSource | null>(null);

  const [steps, setSteps] = useState<CleanupTimelineStep[]>(initialSteps);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<string>("");
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [challengeCode, setChallengeCode] = useState("");
  const [isSubmittingCode, setIsSubmittingCode] = useState(false);
  const [liveBrowserUrl, setLiveBrowserUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const buttonLabel = useMemo(() => {
    if (!cleanupReady) {
      return "Configure Required Keys";
    }

    return isRunning ? "Cleanup Running..." : "Start Cleanup";
  }, [cleanupReady, isRunning]);

  function startCleanup() {
    if (!cleanupReady || isRunning) {
      return;
    }

    eventSourceRef.current?.close();
    setSteps(initialSteps);
    setIsRunning(true);
    setError(null);
    setRunSummary("");
    setChallenge(null);
    setChallengeCode("");
    setLiveBrowserUrl(null);

    const stream = new EventSource(`/api/cleanup/stream?run=${Date.now()}`);

    stream.addEventListener("step", (event) => {
      const payload = JSON.parse(event.data) as { steps: CleanupTimelineStep[] };
      if (payload.steps.length > 0) {
        setSteps(payload.steps);
      }
    });

    stream.addEventListener("result", (event) => {
      const payload = JSON.parse(event.data) as { run: CleanupRun };
      setIsRunning(false);
      setSteps(payload.run.steps);
      setRunSummary(payload.run.summary);
      setChallenge(null);
      setChallengeCode("");
      setLiveBrowserUrl(payload.run.session.liveUrl ?? null);
      stream.close();
      router.push(`/runs/${payload.run.id}`);
      router.refresh();
    });

    stream.addEventListener("challenge", (event) => {
      const payload = JSON.parse(event.data) as { challenge: LoginChallenge };
      setChallenge(payload.challenge);
      setChallengeCode("");
    });

    stream.addEventListener("session", (event) => {
      const payload = JSON.parse(event.data) as {
        session: CleanupRun["session"];
      };
      setLiveBrowserUrl(payload.session.liveUrl ?? null);
    });

    stream.addEventListener("stream-error", (event) => {
      const payload = JSON.parse(event.data) as { message: string };
      setIsRunning(false);
      setError(payload.message);
      setChallenge(null);
      setLiveBrowserUrl(null);
      stream.close();
    });

    eventSourceRef.current = stream;
  }

  async function submitChallengeCode() {
    if (!challenge || !challengeCode.trim()) {
      return;
    }

    setIsSubmittingCode(true);
    setError(null);

    const response = await fetch("/api/cleanup/challenge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        runId: challenge.runId,
        code: challengeCode.trim(),
      }),
    });

    const payload = (await response.json()) as
      | { ok: true }
      | { ok: false; error: string };

    setIsSubmittingCode(false);

    if (!response.ok || !payload.ok) {
      setError(payload.ok ? "Failed to submit code." : payload.error);
      return;
    }

    setChallenge(null);
    setChallengeCode("");
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(92,214,255,0.16),transparent_36%),linear-gradient(145deg,rgba(10,19,35,0.95),rgba(5,11,22,0.95))] p-8 shadow-[0_28px_120px_rgba(3,8,18,0.72)]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="mono rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs uppercase tracking-[0.3em] text-cyan-100">
            Salesforce Browser Cleanup
          </span>
          <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-300">
            One click operator approval
          </span>
        </div>

        <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-tight text-white md:text-6xl">
          CRM Autopilot
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">
          Press start once. The agent signs into Salesforce, reads the configured
          Account record, researches public web sources in a browser, updates the
          Salesforce fields, verifies the writeback, and finishes on a report.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={startCleanup}
            disabled={!cleanupReady || isRunning}
            className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/12 px-6 py-3 text-sm font-medium text-cyan-50 transition hover:border-cyan-200/70 hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {buttonLabel}
          </button>
          {liveBrowserUrl ? (
            <a
              href={liveBrowserUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/12"
            >
              View live browser
            </a>
          ) : null}
        </div>

        {challenge ? (
          <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.08] p-4">
            <div className="text-sm font-medium text-white">
              Salesforce verification required
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {challenge.message}
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={challengeCode}
                onChange={(event) => setChallengeCode(event.target.value)}
                placeholder="Enter email code"
                className="w-full rounded-2xl border border-white/12 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={submitChallengeCode}
                disabled={isSubmittingCode || !challengeCode.trim()}
                className="inline-flex items-center justify-center rounded-2xl border border-cyan-300/35 bg-cyan-300/12 px-5 py-3 text-sm font-medium text-cyan-50 transition hover:border-cyan-200/70 hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmittingCode ? "Submitting..." : "Submit Code"}
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {!cleanupReady ? (
          <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-50">
            Set `SALESFORCE_LOGIN_URL`, `SALESFORCE_USERNAME`,
            `SALESFORCE_PASSWORD`, `SALESFORCE_ACCOUNT_URL`,
            `KERNEL_API_KEY`, and `TZAFON_API_KEY` in `.env.local` before
            running the cleanup.
          </div>
        ) : null}

        {runSummary ? (
          <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.08] p-4 text-sm text-slate-200">
            {runSummary}
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-5 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
          <div className="flex items-start gap-3">
            <Bot className="mt-0.5 h-5 w-5 text-cyan-100" />
            <div>
              <div className="text-sm font-medium text-white">
                Browser research
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                The app launches a Kernel-backed browser session and connects
                automation into it. {kernelNote}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-5 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 text-cyan-100" />
            <div>
              <div className="text-sm font-medium text-white">
                Decisioning
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Lightcone Northstar reviews the browser-collected evidence
                before Salesforce writeback. {northstarNote}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-5 shadow-[0_24px_80px_rgba(4,11,24,0.4)]">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-cyan-100" />
            <div>
              <div className="text-sm font-medium text-white">
                Approval model
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Clicking start is the single operator approval. The report page
                shows the before state, public evidence, and exactly what the
                agent changed in Salesforce.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="xl:col-span-2">
        <CleanupTimeline
          steps={steps}
          title="Live Cleanup Timeline"
          emptyText="The timeline will update while the browser opens Salesforce, researches the web, and writes the verified changes back."
        />
      </div>
    </div>
  );
}
