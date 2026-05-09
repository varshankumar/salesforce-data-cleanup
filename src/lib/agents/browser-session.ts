import { mkdir } from "node:fs/promises";
import path from "node:path";

import Kernel from "@onkernel/sdk";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import type { BrowserSessionSummary } from "@/lib/types";
import { hasKernelConfig } from "@/lib/agents/kernel";

export interface BrowserWorkspace {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  session: BrowserSessionSummary;
  kernelBrowserId?: string;
}

function getArtifactsDir() {
  return path.join(process.cwd(), "data", "artifacts");
}

export async function launchBrowserWorkspace(
  runId: string,
): Promise<BrowserWorkspace> {
  await mkdir(getArtifactsDir(), { recursive: true });

  if (hasKernelConfig()) {
    const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
    const kernelBrowser = await kernel.browsers.create({
      stealth: true,
      viewport: { width: 1440, height: 960 },
    });

    const browser = await chromium.connectOverCDP(kernelBrowser.cdp_ws_url);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    return {
      browser,
      context,
      page,
      kernelBrowserId: kernelBrowser.session_id,
      session: {
        provider: "kernel-cdp",
        sessionId: kernelBrowser.session_id,
        liveUrl: kernelBrowser.browser_live_view_url,
      },
    };
  }

  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });

  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    session: {
      provider: "local-playwright",
      sessionId: runId,
      tracePath: path.join(getArtifactsDir(), `${runId}.zip`),
    },
  };
}

export async function closeBrowserWorkspace(workspace: BrowserWorkspace) {
  try {
    if (workspace.session.provider === "local-playwright" && workspace.session.tracePath) {
      await workspace.context.tracing.stop({
        path: workspace.session.tracePath,
      });
    } else if (workspace.session.provider === "local-playwright") {
      await workspace.context.tracing.stop();
    }
  } finally {
    await workspace.browser.close();

    if (workspace.kernelBrowserId) {
      const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
      try {
        const replays = await kernel.browsers.replays.list(workspace.kernelBrowserId);
        const replay = replays[0];
        workspace.session.replayUrl = replay?.replay_view_url || workspace.session.replayUrl;
      } catch {
        // Ignore replay lookup failures; the cleanup report can still succeed without it.
      }

      await kernel.browsers.deleteByID(workspace.kernelBrowserId);
    }
  }
}
