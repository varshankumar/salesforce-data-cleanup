import Lightcone from "@tzafon/lightcone";

import type {
  BrowserAction,
  FieldChange,
  LoginChallenge,
  SalesforceAccountSnapshot,
} from "@/lib/types";
import { normalizePhoneNumber, normalizeSalesforceValue } from "@/lib/utils";

interface CuaSession {
  client: Lightcone;
  computerId: string;
}

interface CuaLoopOptions {
  instruction: string;
  onAction?: (action: BrowserAction) => void;
  maxSteps?: number;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

function getApiKey() {
  return process.env.TZAFON_API_KEY || process.env.LIGHTCONE_API_KEY || "";
}

function requireApiKey() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Lightcone is not configured. Set TZAFON_API_KEY or LIGHTCONE_API_KEY.");
  }
  return apiKey;
}

function scaleCoord(value: number | undefined, max: number) {
  if (typeof value !== "number") {
    return Math.round(max / 2);
  }
  return Math.max(0, Math.min(max, Math.round((value / 1000) * max)));
}

function coerceSnapshot(input: Partial<SalesforceAccountSnapshot>) {
  return {
    recordUrl: input.recordUrl || "",
    companyName: normalizeSalesforceValue(input.companyName || ""),
    website: normalizeSalesforceValue(input.website || ""),
    billingAddress: normalizeSalesforceValue(input.billingAddress || ""),
    phoneNumber: normalizePhoneNumber(input.phoneNumber || ""),
    employeeCount: normalizeSalesforceValue(input.employeeCount || ""),
    primaryContactName: normalizeSalesforceValue(input.primaryContactName || ""),
    primaryContactTitle: normalizeSalesforceValue(input.primaryContactTitle || ""),
    primaryContactEmail: normalizeSalesforceValue(input.primaryContactEmail || ""),
    capturedAt: new Date().toISOString(),
  };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startSalesforceCuaSession(): Promise<CuaSession> {
  const apiKey = requireApiKey();
  const client = new Lightcone({ apiKey });
  const computer = await client.computers.create({ kind: "browser" });
  const computerId = computer.id as string;
  if (!computerId) {
    throw new Error("Lightcone did not return a computer session id.");
  }
  return { client, computerId };
}

export async function stopSalesforceCuaSession(session: CuaSession) {
  await session.client.computers.delete(session.computerId);
}

async function runCuaLoop(session: CuaSession, options: CuaLoopOptions) {
  const { instruction, onAction, maxSteps = 24 } = options;
  const { client, computerId } = session;

  const tool = {
    type: "computer_use" as const,
    display_width: DEFAULT_VIEWPORT.width,
    display_height: DEFAULT_VIEWPORT.height,
    environment: "browser" as const,
  };

  const initial = await client.computers.screenshot(computerId);
  const screenshotUrl = initial.result?.screenshot_url as string | undefined;
  if (!screenshotUrl) {
    throw new Error("Lightcone screenshot did not return a URL.");
  }

  let response = await client.responses.create({
    model: "tzafon.northstar-cua-fast",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: instruction },
          { type: "input_image", image_url: screenshotUrl, detail: "auto" },
        ],
      },
    ],
    tools: [tool],
    instructions:
      "You are operating a browser to complete a Salesforce cleanup task. Move carefully, avoid destructive actions, and confirm the page before proceeding.",
  });

  for (let step = 0; step < maxSteps; step += 1) {
    const computerCall = response.output?.find((item) => item.type === "computer_call");
    if (!computerCall) {
      return;
    }

    const action = computerCall.action as {
      type?: string;
      x?: number;
      y?: number;
      end_x?: number;
      end_y?: number;
      text?: string;
      keys?: string[];
      scroll_y?: number;
      scroll_x?: number;
      url?: string;
      button?: string;
      status?: string;
      result?: string;
    };

    if (!action?.type) {
      return;
    }

    if (["terminate", "done", "answer"].includes(action.type)) {
      return;
    }

    const x = scaleCoord(action.x, DEFAULT_VIEWPORT.width);
    const y = scaleCoord(action.y, DEFAULT_VIEWPORT.height);
    const endX = scaleCoord(action.end_x, DEFAULT_VIEWPORT.width);
    const endY = scaleCoord(action.end_y, DEFAULT_VIEWPORT.height);

    onAction?.({
      timestamp: new Date().toISOString(),
      scope: "salesforce",
      action: action.type,
      details: action.text || action.keys?.join("+") || action.result,
      url: action.url,
    });

    if (action.type === "click" && action.button === "right") {
      await client.computers.rightClick(computerId, { x, y });
    } else {
      switch (action.type) {
        case "click":
          await client.computers.click(computerId, { x, y });
          break;
        case "double_click":
          await client.computers.doubleClick(computerId, { x, y });
          break;
        case "triple_click":
          await client.computers.tripleClick(computerId, { x, y });
          break;
        case "type":
          await client.computers.type(computerId, { text: action.text || "" });
          break;
        case "key":
        case "keypress":
          await client.computers.hotkey(computerId, { keys: action.keys || [] });
          break;
        case "key_down":
          if (action.keys?.[0]) {
            await client.computers.keyDown(computerId, { key: action.keys[0] });
          }
          break;
        case "key_up":
          if (action.keys?.[0]) {
            await client.computers.keyUp(computerId, { key: action.keys[0] });
          }
          break;
        case "scroll":
          await client.computers.scroll(computerId, {
            dx: 0,
            dy: action.scroll_y ?? 0,
            x,
            y,
          });
          break;
        case "hscroll":
          await client.computers.scroll(computerId, {
            dx: action.scroll_x ?? 0,
            dy: 0,
            x,
            y,
          });
          break;
        case "drag":
          await client.computers.drag(computerId, {
            x,
            y,
            end_x: endX,
            end_y: endY,
          });
          break;
        case "navigate":
          if (action.url) {
            await client.computers.navigate(computerId, { url: action.url });
          }
          break;
        case "wait":
          await sleep(1000);
          break;
        default:
          return;
      }
    }

    await sleep(1000);

    const nextShot = await client.computers.screenshot(computerId);
    const nextUrl = nextShot.result?.screenshot_url as string | undefined;
    if (!nextUrl) {
      throw new Error("Lightcone screenshot did not return a URL.");
    }

    response = await client.responses.create({
      model: "tzafon.northstar-cua-fast",
      previous_response_id: response.id as string,
      input: [
        {
          type: "computer_call_output",
          call_id: computerCall.call_id,
          output: { type: "input_image", image_url: nextUrl, detail: "auto" },
        },
      ],
      tools: [tool],
    });
  }
}

async function extractSnapshot(session: CuaSession, instruction: string) {
  const { client, computerId } = session;
  const shot = await client.computers.screenshot(computerId);
  const screenshotUrl = shot.result?.screenshot_url as string | undefined;
  if (!screenshotUrl) {
    throw new Error("Lightcone screenshot did not return a URL.");
  }

  const extraction = await client.responses.create({
    model: "tzafon.northstar-cua-fast",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: instruction },
          { type: "input_image", image_url: screenshotUrl, detail: "auto" },
        ],
      },
    ],
  });

  const message = extraction.output?.find((item) => item.type === "message");
  const textBlock = message?.content?.find(
    (block) => typeof block === "object" && (block as { text?: string }).text,
  ) as { text?: string } | undefined;

  if (!textBlock?.text) {
    return null;
  }

  try {
    return JSON.parse(textBlock.text) as Partial<SalesforceAccountSnapshot>;
  } catch {
    return null;
  }
}

async function detectVerificationPrompt(session: CuaSession) {
  const { client, computerId } = session;
  const shot = await client.computers.screenshot(computerId);
  const screenshotUrl = shot.result?.screenshot_url as string | undefined;
  if (!screenshotUrl) {
    throw new Error("Lightcone screenshot did not return a URL.");
  }

  const detection = await client.responses.create({
    model: "tzafon.northstar-cua-fast",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Return JSON only: {\"needsCode\":true} if you see a verification code prompt on the page, otherwise {\"needsCode\":false}.",
          },
          { type: "input_image", image_url: screenshotUrl, detail: "auto" },
        ],
      },
    ],
  });

  const message = detection.output?.find((item) => item.type === "message");
  const textBlock = message?.content?.find(
    (block) => typeof block === "object" && (block as { text?: string }).text,
  ) as { text?: string } | undefined;

  if (!textBlock?.text) {
    return false;
  }

  try {
    const parsed = JSON.parse(textBlock.text) as { needsCode?: boolean };
    return Boolean(parsed.needsCode);
  } catch {
    return false;
  }
}

export async function cuaLoginAndOpenAccount(
  session: CuaSession,
  onAction?: (action: BrowserAction) => void,
  onChallenge?: (challenge: LoginChallenge) => Promise<string>,
  runId?: string,
) {
  const loginUrl = process.env.SALESFORCE_LOGIN_URL || "";
  const accountUrl = process.env.SALESFORCE_ACCOUNT_URL || "";
  const username = process.env.SALESFORCE_USERNAME || "";
  const password = process.env.SALESFORCE_PASSWORD || "";

  if (!loginUrl || !accountUrl || !username || !password) {
    throw new Error("Salesforce credentials are incomplete for CUA login.");
  }

  await session.client.computers.navigate(session.computerId, { url: loginUrl });
  onAction?.({
    timestamp: new Date().toISOString(),
    scope: "salesforce",
    action: "navigate",
    url: loginUrl,
  });
  await sleep(1500);

  const instruction = [
    "You are already on the Salesforce login page. Do not open new search pages.",
    `Username: ${username}`,
    `Password: ${password}`,
    "After login, navigate to the Account record URL and make sure the page is loaded.",
    `Account URL: ${accountUrl}`,
    "If a verification prompt appears, wait for the operator to complete it and then continue.",
    "Stop when the Account record page is visible and stable.",
  ].join("\n");

  await runCuaLoop(session, { instruction, onAction, maxSteps: 28 });

  const needsCode = await detectVerificationPrompt(session);
  if (needsCode) {
    if (!onChallenge) {
      throw new Error("Salesforce requested a verification code, but no challenge handler was configured.");
    }

    const code = await onChallenge({
      runId: runId || "cua",
      type: "salesforce-email-code",
      message:
        "Salesforce requested a verification code in the CUA browser. Enter the code to continue.",
    });

    const codeInstruction = [
      "Enter the provided verification code into the Salesforce prompt and submit.",
      `Code: ${code}`,
      "Then wait until the Account record page is visible.",
    ].join("\n");

    await runCuaLoop(session, { instruction: codeInstruction, onAction, maxSteps: 12 });
  }
}

export async function cuaReadSalesforceSnapshot(session: CuaSession) {
  const instruction = [
    "Read the Salesforce Account record currently on screen.",
    "Return JSON ONLY with these keys:",
    "companyName, website, billingAddress, phoneNumber, employeeCount, primaryContactName, primaryContactTitle, primaryContactEmail, recordUrl.",
    "If a value is missing, return an empty string.",
  ].join("\n");

  const raw = await extractSnapshot(session, instruction);
  if (!raw) {
    return null;
  }

  return coerceSnapshot(raw);
}

export async function cuaApplySalesforceChanges(
  session: CuaSession,
  changes: FieldChange[],
  onAction?: (action: BrowserAction) => void,
) {
  const updates = changes
    .filter((change) => change.status === "proposed")
    .map((change) => `${change.label}: ${change.proposedValue}`)
    .join("\n");

  if (!updates) {
    return;
  }

  const instruction = [
    "Open the Edit action on the Salesforce Account record.",
    "Update the fields exactly as listed below.",
    "Do not change any other fields.",
    "After all fields are updated, click Save and wait for the record view to return.",
    "Fields to update:",
    updates,
  ].join("\n");

  await runCuaLoop(session, { instruction, onAction, maxSteps: 24 });
}
