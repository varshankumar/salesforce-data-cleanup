import { randomUUID } from "node:crypto";

import { closeBrowserWorkspace, launchBrowserWorkspace } from "@/lib/agents/browser-session";
import { researchCompanyWithBrowser } from "@/lib/agents/browser-research";
import { hasKernelConfig } from "@/lib/agents/kernel";
import { hasNorthstarConfig } from "@/lib/agents/lightcone";
import {
  applyChangesToSalesforceBrowser,
  hasSalesforceBrowserConfig,
  loginToSalesforce,
  openSalesforceAccount,
  scrapeSalesforceAccount,
} from "@/lib/agents/salesforce";
import {
  cuaApplySalesforceChanges,
  cuaLoginAndOpenAccount,
  cuaReadSalesforceSnapshot,
  startSalesforceCuaSession,
  stopSalesforceCuaSession,
} from "@/lib/agents/salesforce-cua";
import { waitForChallengeResponse } from "@/lib/cleanup/challenge-manager";
import { saveCleanupRun } from "@/lib/data/store";
import type {
  BrowserAction,
  CleanupRun,
  CleanupStepKey,
  CleanupTimelineStep,
  FieldChange,
  LoginChallenge,
  SourceEvidence,
} from "@/lib/types";

const stepDefinitions: Array<{ key: CleanupStepKey; label: string; note: string }> = [
  {
    key: "opening-browser",
    label: "Opening browser session",
    note: "Launching a Kernel-backed browser session for Salesforce and public-web research.",
  },
  {
    key: "signing-into-salesforce",
    label: "Signing into Salesforce",
    note: "Authenticating with the configured Salesforce developer account.",
  },
  {
    key: "reading-salesforce-record",
    label: "Reading Salesforce record",
    note: "Loading the configured Account record and capturing current field values.",
  },
  {
    key: "researching-public-web",
    label: "Researching public web",
    note: "Using the Kernel browser plus Lightcone-reviewed evidence gathering on public company sources.",
  },
  {
    key: "comparing-evidence",
    label: "Comparing evidence",
    note: "Lightcone reviews the browser-collected evidence against current Salesforce values.",
  },
  {
    key: "updating-salesforce",
    label: "Updating Salesforce",
    note: "Opening the record edit form and writing the selected field updates.",
  },
  {
    key: "verifying-record",
    label: "Verifying record",
    note: "Reloading the Account page to confirm what actually landed in Salesforce.",
  },
  {
    key: "writing-report",
    label: "Writing report",
    note: "Persisting the run timeline, evidence, and final change report.",
  },
];

function buildPendingSteps(): CleanupTimelineStep[] {
  return stepDefinitions.map((step) => ({
    key: step.key,
    label: step.label,
    status: "pending",
  }));
}

function markStep(
  steps: CleanupTimelineStep[],
  key: CleanupStepKey,
  status: CleanupTimelineStep["status"],
  note?: string,
) {
  const index = steps.findIndex((step) => step.key === key);
  if (index === -1) return steps;

  const next = [...steps];
  next[index] = {
    ...next[index],
    status,
    note: note ?? next[index].note,
    timestamp: new Date().toISOString(),
  };
  return next;
}

function finalizeChanges(changes: FieldChange[], verifiedAfter: CleanupRun["after"]) {
  if (!verifiedAfter) {
    return changes;
  }

  return changes.map((change) => ({
    ...change,
    finalValue: verifiedAfter[change.field] || change.finalValue || change.oldValue,
  }));
}

export async function runCleanup(
  onStep?: (steps: CleanupTimelineStep[]) => void,
  onChallenge?: (challenge: LoginChallenge) => void,
  onSession?: (session: CleanupRun["session"]) => void,
) {
  if (!hasSalesforceBrowserConfig()) {
    throw new Error(
      "Salesforce credentials are incomplete. Configure SALESFORCE_LOGIN_URL, SALESFORCE_USERNAME, SALESFORCE_PASSWORD, and SALESFORCE_ACCOUNT_URL.",
    );
  }

  if (!hasKernelConfig()) {
    throw new Error(
      "Kernel is not configured. Set KERNEL_API_KEY to launch the browser session required for this hackathon flow.",
    );
  }

  if (!hasNorthstarConfig()) {
    throw new Error(
      "Lightcone is not configured. Set TZAFON_API_KEY or LIGHTCONE_API_KEY for Northstar evidence review.",
    );
  }

  const runId = `cleanup_${randomUUID()}`;
  let steps = buildPendingSteps();
  let before = null;
  let after = null;
  let changes: FieldChange[] = [];
  let summary = "";
  let salesforceRecordUrl = process.env.SALESFORCE_ACCOUNT_URL || "";
  let errorMessage: string | undefined;
  let evidence: SourceEvidence[] = [];
  const browserActions: BrowserAction[] = [];
  const workspace = await launchBrowserWorkspace(runId);
  onSession?.(workspace.session);

  const useCua = process.env.SALESFORCE_USE_CUA === "true";
  let cuaSession: Awaited<ReturnType<typeof startSalesforceCuaSession>> | null = null;

  const logAction = (action: BrowserAction) => {
    browserActions.push(action);
  };

  try {
    steps = markStep(steps, "opening-browser", "active", stepDefinitions[0].note);
    onStep?.(steps);
    steps = markStep(steps, "opening-browser", "completed");
    onStep?.(steps);

    steps = markStep(
      steps,
      "signing-into-salesforce",
      "active",
      stepDefinitions[1].note,
    );
    onStep?.(steps);
    if (useCua) {
      cuaSession = await startSalesforceCuaSession();
      await cuaLoginAndOpenAccount(
        cuaSession,
        logAction,
        async (challenge) => {
          steps = markStep(
            steps,
            "signing-into-salesforce",
            "active",
            "Waiting for the Salesforce email verification code from the operator.",
          );
          onStep?.(steps);
          onChallenge?.(challenge);
          return waitForChallengeResponse(runId);
        },
        runId,
      );
    } else {
      await loginToSalesforce(workspace.page, {
        runId,
        onAction: logAction,
        onChallenge: async (challenge) => {
          steps = markStep(
            steps,
            "signing-into-salesforce",
            "active",
            "Waiting for the Salesforce email verification code from the operator.",
          );
          onStep?.(steps);
          onChallenge?.(challenge);
          return waitForChallengeResponse(runId);
        },
      });
    }
    steps = markStep(steps, "signing-into-salesforce", "completed");
    onStep?.(steps);

    steps = markStep(
      steps,
      "reading-salesforce-record",
      "active",
      stepDefinitions[2].note,
    );
    onStep?.(steps);
    if (useCua && cuaSession) {
      before = await cuaReadSalesforceSnapshot(cuaSession);
    } else {
      salesforceRecordUrl = await openSalesforceAccount(workspace.page);
      before = await scrapeSalesforceAccount(workspace.page);
    }
    if (!before) {
      throw new Error("Salesforce snapshot was not captured.");
    }
    const snapshotSummary = before
      ? `Found Account Name: ${before.companyName || "Not set"}. Website: ${before.website || "Not set"}. Phone: ${before.phoneNumber || "Not set"}. Billing Address: ${before.billingAddress || "Not set"}.`
      : "No Salesforce snapshot was captured.";
    steps = markStep(
      steps,
      "reading-salesforce-record",
      "completed",
      snapshotSummary,
    );
    onStep?.(steps);

    steps = markStep(
      steps,
      "researching-public-web",
      "active",
      stepDefinitions[3].note,
    );
    onStep?.(steps);
    const research = await researchCompanyWithBrowser(
      workspace.context,
      before,
      logAction,
    );
    summary = research.summary;
    changes = research.changes;
    evidence = research.evidence;
    steps = markStep(steps, "researching-public-web", "completed");
    onStep?.(steps);

    await workspace.page.bringToFront();

    steps = markStep(
      steps,
      "comparing-evidence",
      "active",
      stepDefinitions[4].note,
    );
    onStep?.(steps);
    steps = markStep(
      steps,
      "comparing-evidence",
      "completed",
      `${changes.filter((change) => change.status === "proposed").length} field updates were proposed.`,
    );
    onStep?.(steps);

    steps = markStep(
      steps,
      "updating-salesforce",
      "active",
      stepDefinitions[5].note,
    );
    onStep?.(steps);
    await workspace.page.bringToFront();
    const hasProposedChanges = changes.some(
      (change) => change.status === "proposed",
    );

    if (hasProposedChanges) {
      if (useCua && cuaSession) {
        await cuaApplySalesforceChanges(cuaSession, changes, logAction);
      } else {
        changes = await applyChangesToSalesforceBrowser(
          workspace.page,
          salesforceRecordUrl,
          changes,
          logAction,
        );
      }
    }
    steps = markStep(
      steps,
      "updating-salesforce",
      "completed",
      hasProposedChanges
        ? "Salesforce writeback completed."
        : "No changes needed to be written back to Salesforce.",
    );
    onStep?.(steps);

    steps = markStep(
      steps,
      "verifying-record",
      "active",
      stepDefinitions[6].note,
    );
    onStep?.(steps);
    if (useCua && cuaSession) {
      after = await cuaReadSalesforceSnapshot(cuaSession);
    } else {
      await openSalesforceAccount(workspace.page);
      after = await scrapeSalesforceAccount(workspace.page);
    }
    changes = finalizeChanges(changes, after);
    steps = markStep(steps, "verifying-record", "completed");
    onStep?.(steps);

    steps = markStep(
      steps,
      "writing-report",
      "active",
      stepDefinitions[7].note,
    );
    onStep?.(steps);

    const run: CleanupRun = {
      id: runId,
      status: "completed",
      mode: "salesforce-browser-live",
      summary,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      salesforceRecordUrl,
      steps,
      before,
      after,
      evidence,
      changes,
      session: workspace.session,
      browserActions,
    };

    steps = markStep(steps, "writing-report", "completed");
    run.steps = steps;
    await saveCleanupRun(run);
    onStep?.(steps);
    return run;
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Cleanup failed unexpectedly.";

    const activeStep =
      steps.find((step) => step.status === "active")?.key || "writing-report";
    steps = markStep(steps, activeStep, "error", errorMessage);
    steps = markStep(steps, "writing-report", "completed");
    onStep?.(steps);

    const failedRun: CleanupRun = {
      id: runId,
      status: "failed",
      mode: "salesforce-browser-live",
      summary: errorMessage,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      salesforceRecordUrl,
      steps,
      before,
      after,
      evidence,
      changes,
      session: workspace.session,
      browserActions,
      errorMessage,
    };

    await saveCleanupRun(failedRun);
    return failedRun;
  } finally {
    if (cuaSession) {
      await stopSalesforceCuaSession(cuaSession);
    }
    await closeBrowserWorkspace(workspace);
  }
}
