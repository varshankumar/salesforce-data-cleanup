import type { Page } from "playwright";

import type {
  CleanupField,
  FieldChange,
  LoginChallenge,
  SalesforceAccountSnapshot,
} from "@/lib/types";
import {
  domainFromUrl,
  formatFieldLabel,
  joinAddressParts,
  isLikelyPlaceholderName,
  normalizeForCompare,
  normalizePhoneNumber,
  normalizeSalesforceValue,
  normalizeWhitespace,
  parseLocationParts,
  sanitizeNumericInput,
  toAbsoluteUrl,
} from "@/lib/utils";

interface SalesforceFieldConfig {
  field: CleanupField;
  reportLabel: string;
  labels: string[];
}

const salesforceFields: SalesforceFieldConfig[] = [
  {
    field: "companyName",
    reportLabel: "Company Name",
    labels: ["Account Name", "Name"],
  },
  {
    field: "website",
    reportLabel: "Website",
    labels: ["Website"],
  },
  {
    field: "billingAddress",
    reportLabel: "Billing Address",
    labels: ["Billing Address", "Headquarters"],
  },
  {
    field: "phoneNumber",
    reportLabel: "Phone Number",
    labels: ["Phone"],
  },
  {
    field: "employeeCount",
    reportLabel: "Employee Count",
    labels: ["Employees", "Employee Count"],
  },
  {
    field: "primaryContactName",
    reportLabel: "Primary Contact",
    labels: [
      process.env.SALESFORCE_PRIMARY_CONTACT_NAME_LABEL ||
        "Primary Contact Name",
      "Primary Contact",
    ],
  },
  {
    field: "primaryContactTitle",
    reportLabel: "Primary Contact Title",
    labels: [
      process.env.SALESFORCE_PRIMARY_CONTACT_TITLE_LABEL ||
        "Primary Contact Title",
      "Primary Contact Title",
    ],
  },
  {
    field: "primaryContactEmail",
    reportLabel: "Primary Contact Email",
    labels: [
      process.env.SALESFORCE_PRIMARY_CONTACT_EMAIL_LABEL ||
        "Primary Contact Email",
      "Primary Contact Email",
    ],
  },
];

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function deriveEditUrl(recordUrl: string) {
  if (recordUrl.includes("/edit")) {
    return recordUrl;
  }

  if (recordUrl.includes("/view")) {
    return recordUrl.replace("/view", "/edit");
  }

  return `${recordUrl.replace(/\/$/, "")}/edit`;
}

async function waitForSettledPage(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

async function dismissSalesforcePopup(page: Page) {
  const selectors = [
    "button[title='Close']",
    "button[aria-label='Close']",
    "button[title='Dismiss']",
    "button[aria-label='Dismiss']",
    ".slds-modal__close",
    ".slds-modal__close button",
    ".guidedTourSelector button",
  ];

  const textButtons = [
    /skip/i,
    /got it/i,
    /close/i,
    /dismiss/i,
    /finish/i,
    /next/i,
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }

    try {
      await locator.click({ timeout: 1200 });
      await page.waitForTimeout(300);
    } catch {
      // Ignore and try the remaining popup affordances.
    }
  }

  for (const pattern of textButtons) {
    const locator = page.getByRole("button", { name: pattern }).first();
    if ((await locator.count()) === 0) {
      continue;
    }

    try {
      await locator.click({ timeout: 1200 });
      await page.waitForTimeout(300);
    } catch {
      // Ignore and keep trying other close actions.
    }
  }

  try {
    await page.keyboard.press("Escape");
  } catch {
    // Ignore escape failures.
  }
}

async function findFieldValue(
  page: Page,
  labels: string[],
  multiLine = false,
): Promise<string> {
  return page.evaluate(
    ({ labels, multiLine }) => {
      const normalize = (value: string) =>
        value.replace(/\s+/g, " ").trim().toLowerCase();

      const visible = (element: Element) => {
        const html = element as HTMLElement;
        const style = window.getComputedStyle(html);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          html.offsetParent !== null
        );
      };

      const noise = new Set(["edit", "show more", "show less", "actions"]);
      const labelSet = labels.map(normalize);
      const nodes = Array.from(document.querySelectorAll("body *")).filter(
        (element) => visible(element),
      );

      for (const node of nodes) {
        const nodeText = normalize(node.textContent || "");
        if (!labelSet.includes(nodeText)) {
          continue;
        }

        let current: HTMLElement | null = node as HTMLElement;
        for (let depth = 0; current && depth < 6; depth += 1) {
          const lines = (current.innerText || "")
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);

          if (lines.length === 0) {
            current = current.parentElement;
            continue;
          }

          const index = lines.findIndex((line) =>
            labelSet.includes(normalize(line)),
          );

          if (index === -1) {
            current = current.parentElement;
            continue;
          }

          const valueLines = lines
            .slice(index + 1)
            .filter((line) => !noise.has(normalize(line)));

          if (valueLines.length > 0) {
            return multiLine ? valueLines.join(", ") : valueLines[0];
          }

          current = current.parentElement;
        }

        const siblingText = (node.nextElementSibling as HTMLElement | null)
          ?.innerText;
        if (siblingText?.trim()) {
          return multiLine
            ? siblingText
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .join(", ")
            : siblingText.trim();
        }
      }

      return "";
    },
    { labels, multiLine },
  );
}

async function fillTextInput(page: Page, labels: string[], value: string) {
  const exactPatterns = labels.map(
    (label) => new RegExp(`^${escapeRegex(label)}$`, "i"),
  );

  for (const pattern of exactPatterns) {
    const locator = page.getByLabel(pattern).first();
    if ((await locator.count()) > 0) {
      await locator.fill(value);
      return true;
    }
  }

  for (const pattern of exactPatterns) {
    const textbox = page.getByRole("textbox", { name: pattern }).first();
    if ((await textbox.count()) > 0) {
      await textbox.fill(value);
      return true;
    }
  }

  return false;
}

async function readInputValue(page: Page, labels: string[]) {
  const exactPatterns = labels.map(
    (label) => new RegExp(`^${escapeRegex(label)}$`, "i"),
  );

  for (const pattern of exactPatterns) {
    const locator = page.getByLabel(pattern).first();
    if ((await locator.count()) > 0) {
      const value = await locator.inputValue().catch(() => "");
      if (value.trim()) {
        return normalizeWhitespace(value);
      }
    }
  }

  for (const pattern of exactPatterns) {
    const textbox = page.getByRole("textbox", { name: pattern }).first();
    if ((await textbox.count()) > 0) {
      const value = await textbox.inputValue().catch(() => "");
      if (value.trim()) {
        return normalizeWhitespace(value);
      }
    }
  }

  return "";
}

async function applyCompoundAddress(page: Page, address: string) {
  const parts = parseLocationParts(address);
  if (!parts) {
    return {
      ok: false,
      note:
        "The researched headquarters value was not structured enough to map into Salesforce Billing Address fields.",
    };
  }

  let touched = false;
  if (parts.street) {
    touched =
      (await fillTextInput(page, ["Billing Street"], parts.street)) || touched;
  }
  touched =
    (await fillTextInput(page, ["Billing City"], parts.city)) || touched;
  touched =
    (await fillTextInput(page, ["Billing State/Province"], parts.stateOrRegion)) ||
    touched;
  if (parts.postalCode) {
    touched =
      (await fillTextInput(page, ["Billing Zip/Postal Code"], parts.postalCode)) ||
      touched;
  }

  if (parts.country) {
    touched =
      (await fillTextInput(page, ["Billing Country"], parts.country)) || touched;
  }

  return {
    ok: touched,
    note: touched
      ? "Mapped structured headquarters value into Billing Address fields."
      : "Billing Address inputs were not found in the Salesforce edit form.",
  };
}

export function getConfiguredSalesforceAccountUrl() {
  return requiredEnv("SALESFORCE_ACCOUNT_URL");
}

export function hasSalesforceBrowserConfig() {
  return Boolean(
    process.env.SALESFORCE_LOGIN_URL &&
      process.env.SALESFORCE_USERNAME &&
      process.env.SALESFORCE_PASSWORD &&
      process.env.SALESFORCE_ACCOUNT_URL,
  );
}

export function getSalesforceFieldMetadata() {
  return salesforceFields.map((field) => ({
    field: field.field,
    label: field.reportLabel,
    salesforceLabels: field.labels,
  }));
}

async function findEmailCodeInput(page: Page) {
  const candidates = [
    page.getByLabel(/verification code|email code|code/i).first(),
    page.getByRole("textbox", { name: /verification code|email code|code/i }).first(),
    page.locator("input[name*='otp'], input[name*='code'], input[type='tel']").first(),
  ];

  for (const locator of candidates) {
    if ((await locator.count()) > 0) {
      return locator;
    }
  }

  return null;
}

export async function loginToSalesforce(
  page: Page,
  options?: {
    runId?: string;
    onChallenge?: (challenge: LoginChallenge) => Promise<string>;
  },
) {
  const loginUrl = requiredEnv("SALESFORCE_LOGIN_URL");
  const username = requiredEnv("SALESFORCE_USERNAME");
  const password = requiredEnv("SALESFORCE_PASSWORD");

  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  const usernameInput = page.getByLabel(/username/i).first();
  const passwordInput = page.getByLabel(/password/i).first();

  if ((await usernameInput.count()) > 0 && (await passwordInput.count()) > 0) {
    await usernameInput.fill(username);
    await passwordInput.fill(password);
    await page.getByRole("button", { name: /log in/i }).click();
  }

  await waitForSettledPage(page);
  await dismissSalesforcePopup(page);

  const emailCodeInput = await findEmailCodeInput(page);
  if (emailCodeInput) {
    if (!options?.runId || !options.onChallenge) {
      throw new Error(
        "Salesforce requested an email verification code, but no challenge handler was configured.",
      );
    }

    const code = await options.onChallenge({
      runId: options.runId,
      type: "salesforce-email-code",
      message:
        "Salesforce sent a verification code by email. Enter the code here to resume the cleanup run.",
    });

    await emailCodeInput.fill(code.trim());

    const verifyButtonCandidates = [
      page.getByRole("button", { name: /verify|continue|submit|next/i }).first(),
      page.locator("button[type='submit']").first(),
      page.locator("input[type='submit']").first(),
    ];

    let submitted = false;
    for (const button of verifyButtonCandidates) {
      if ((await button.count()) > 0) {
        await button.click();
        submitted = true;
        break;
      }
    }

    if (!submitted) {
      await emailCodeInput.press("Enter");
    }

    await waitForSettledPage(page);
    await dismissSalesforcePopup(page);
  }

  if (page.url().includes("login.salesforce.com") && (await usernameInput.count()) > 0) {
    throw new Error(
      "Salesforce login did not complete. Check credentials or org login restrictions.",
    );
  }

  const bodyText = await page.textContent("body");
  if (bodyText?.match(/verify your identity|multi-factor authentication/i)) {
    throw new Error(
      "Salesforce still requested identity verification after the login step.",
    );
  }
}

export async function openSalesforceAccount(page: Page) {
  const accountUrl = getConfiguredSalesforceAccountUrl();
  await page.goto(accountUrl, { waitUntil: "domcontentloaded" });
  await waitForSettledPage(page);
  await dismissSalesforcePopup(page);
  return page.url();
}

async function scrapeSalesforceAccountFromEditForm(page: Page) {
  const companyName = await readInputValue(page, ["Account Name", "Name"]);
  const website = await readInputValue(page, ["Website"]);
  const phoneNumber = await readInputValue(page, ["Phone"]);
  const employeeCount = await readInputValue(page, [
    "Employees",
    "Employee Count",
  ]);
  const primaryContactName = await readInputValue(page, [
    process.env.SALESFORCE_PRIMARY_CONTACT_NAME_LABEL || "Primary Contact Name",
    "Primary Contact",
  ]);
  const primaryContactTitle = await readInputValue(page, [
    process.env.SALESFORCE_PRIMARY_CONTACT_TITLE_LABEL ||
      "Primary Contact Title",
  ]);
  const primaryContactEmail = await readInputValue(page, [
    process.env.SALESFORCE_PRIMARY_CONTACT_EMAIL_LABEL ||
      "Primary Contact Email",
  ]);

  const billingStreet = await readInputValue(page, ["Billing Street"]);
  const billingCity = await readInputValue(page, ["Billing City"]);
  const billingState = await readInputValue(page, ["Billing State/Province"]);
  const billingPostalCode = await readInputValue(page, ["Billing Zip/Postal Code"]);
  const billingCountry = await readInputValue(page, ["Billing Country"]);
  const billingAddress = joinAddressParts([
    billingStreet,
    billingCity,
    billingState,
    billingPostalCode,
    billingCountry,
  ]);

  return {
    companyName,
    website,
    billingAddress,
    phoneNumber,
    employeeCount,
    primaryContactName,
    primaryContactTitle,
    primaryContactEmail,
  };
}

export async function scrapeSalesforceAccount(
  page: Page,
): Promise<SalesforceAccountSnapshot> {
  const recordUrl = page.url();
  const heading = normalizeWhitespace(
    (await page.getByRole("heading").first().textContent()) || "",
  );

  const companyNameFromField = await findFieldValue(page, [
    "Account Name",
    "Name",
  ]);
  const companyName =
    normalizeWhitespace(companyNameFromField) ||
    (isLikelyPlaceholderName(heading) ? "" : heading);

  const websiteRaw = await findFieldValue(page, ["Website"]);
  const phoneRaw = await findFieldValue(page, ["Phone"]);
  const billingAddressRaw =
    (await findFieldValue(page, ["Billing Address"], true)) ||
    (await findFieldValue(page, ["Headquarters"], true));

  const employeeCount = await findFieldValue(page, [
    "Employees",
    "Employee Count",
  ]);

  const primaryContactName = await findFieldValue(page, [
    process.env.SALESFORCE_PRIMARY_CONTACT_NAME_LABEL || "Primary Contact Name",
    "Primary Contact",
  ]);

  const primaryContactTitle = await findFieldValue(page, [
    process.env.SALESFORCE_PRIMARY_CONTACT_TITLE_LABEL ||
      "Primary Contact Title",
  ]);

  const primaryContactEmail = await findFieldValue(page, [
    process.env.SALESFORCE_PRIMARY_CONTACT_EMAIL_LABEL ||
      "Primary Contact Email",
  ]);

  let editSnapshot = {
    companyName: "",
    website: "",
    billingAddress: "",
    phoneNumber: "",
    employeeCount: "",
    primaryContactName: "",
    primaryContactTitle: "",
    primaryContactEmail: "",
  };

  try {
    await page.goto(deriveEditUrl(recordUrl), { waitUntil: "domcontentloaded" });
    await waitForSettledPage(page);
    await dismissSalesforcePopup(page);
    editSnapshot = await scrapeSalesforceAccountFromEditForm(page);
  } catch {
    // Keep the view-page snapshot if the edit form cannot be opened or parsed.
  }

  const mergedCompanyName =
    normalizeSalesforceValue(editSnapshot.companyName) ||
    normalizeSalesforceValue(companyName);
  const mergedWebsite =
    normalizeSalesforceValue(editSnapshot.website) ||
    normalizeSalesforceValue(websiteRaw);
  const mergedAddress =
    normalizeSalesforceValue(editSnapshot.billingAddress) ||
    normalizeSalesforceValue(billingAddressRaw);
  const mergedPhoneNumber =
    normalizeSalesforceValue(editSnapshot.phoneNumber) ||
    normalizeSalesforceValue(phoneRaw);
  const mergedEmployeeCount =
    normalizeSalesforceValue(editSnapshot.employeeCount) ||
    normalizeSalesforceValue(employeeCount);
  const mergedPrimaryContactName =
    normalizeSalesforceValue(editSnapshot.primaryContactName) ||
    normalizeSalesforceValue(primaryContactName);
  const mergedPrimaryContactTitle =
    normalizeSalesforceValue(editSnapshot.primaryContactTitle) ||
    normalizeSalesforceValue(primaryContactTitle);
  const mergedPrimaryContactEmail =
    normalizeSalesforceValue(editSnapshot.primaryContactEmail) ||
    normalizeSalesforceValue(primaryContactEmail);

  return {
    recordUrl,
    companyName: mergedCompanyName,
    website: mergedWebsite,
    billingAddress: mergedAddress,
    phoneNumber: normalizePhoneNumber(mergedPhoneNumber),
    employeeCount: mergedEmployeeCount,
    primaryContactName: mergedPrimaryContactName,
    primaryContactTitle: mergedPrimaryContactTitle,
    primaryContactEmail: mergedPrimaryContactEmail,
    capturedAt: new Date().toISOString(),
  };
}

export async function applyChangesToSalesforceBrowser(
  page: Page,
  recordUrl: string,
  changes: FieldChange[],
) {
  const editUrl = deriveEditUrl(recordUrl);
  await page.goto(editUrl, { waitUntil: "domcontentloaded" });
  await waitForSettledPage(page);
  await dismissSalesforcePopup(page);

  const results = [...changes];

  for (let index = 0; index < results.length; index += 1) {
    const change = results[index];
    if (change.status !== "proposed") {
      continue;
    }

    let applied = false;
    let note = "";

    if (change.field === "billingAddress") {
      const addressResult = await applyCompoundAddress(
        page,
        change.proposedValue,
      );
      applied = addressResult.ok;
      note = addressResult.note;
    } else if (change.field === "employeeCount") {
      const numericValue = sanitizeNumericInput(change.proposedValue);
      if (!numericValue) {
        applied = false;
        note = "The researched employee count did not resolve to a numeric value.";
      } else {
        applied = await fillTextInput(page, change.salesforceLabels, numericValue);
        note = applied
          ? "Updated numeric Employees field."
          : `Salesforce input not found for ${formatFieldLabel(change.field)}.`;
      }
    } else if (change.field === "website") {
      applied = await fillTextInput(
        page,
        change.salesforceLabels,
        toAbsoluteUrl(change.proposedValue),
      );
      note = applied
        ? "Updated Website field."
        : "Website input was not found in the Salesforce edit form.";
    } else if (change.field === "phoneNumber") {
      applied = await fillTextInput(
        page,
        change.salesforceLabels,
        normalizePhoneNumber(change.proposedValue),
      );
      note = applied
        ? "Updated Phone field."
        : "Phone input was not found in the Salesforce edit form.";
    } else {
      applied = await fillTextInput(
        page,
        change.salesforceLabels,
        change.proposedValue,
      );
      note = applied
        ? `Updated ${formatFieldLabel(change.field)}.`
        : `Salesforce input not found for ${formatFieldLabel(change.field)}.`;
    }

    results[index] = {
      ...change,
      status: applied ? "applied" : "skipped",
      statusNote: note,
      finalValue: applied ? change.proposedValue : change.oldValue,
    };
  }

  await page.getByRole("button", { name: /^Save$/i }).click();
  await page.waitForTimeout(2500);

  return results;
}

export function buildNoChangeEntries(snapshot: SalesforceAccountSnapshot) {
  return salesforceFields.map<FieldChange>((field) => {
    const currentValue =
      snapshot[field.field as keyof SalesforceAccountSnapshot];

    return {
      field: field.field,
      label: field.reportLabel,
      salesforceLabels: field.labels,
      oldValue:
        typeof currentValue === "string"
          ? normalizeSalesforceValue(currentValue)
          : "",
      proposedValue:
        typeof currentValue === "string"
          ? normalizeSalesforceValue(currentValue)
          : "",
      confidence: 0.5,
      reasoning: "No public-source recommendation generated for this field.",
      status: "skipped" as const,
      statusNote: "No reliable public evidence was found for an update.",
      sources: [],
    };
  });
}

export function replaceChange(
  changes: FieldChange[],
  nextChange: FieldChange,
): FieldChange[] {
  return changes.map((change) =>
    change.field === nextChange.field ? nextChange : change,
  );
}

export function hasMeaningfulDifference(oldValue: string, nextValue: string) {
  return normalizeForCompare(oldValue) !== normalizeForCompare(nextValue);
}

export function hasFieldMeaningfulDifference(
  field: CleanupField,
  oldValue: string,
  nextValue: string,
) {
  if (field === "website") {
    return domainFromUrl(oldValue) !== domainFromUrl(nextValue);
  }

  if (field === "employeeCount") {
    return sanitizeNumericInput(oldValue) !== sanitizeNumericInput(nextValue);
  }

  if (field === "phoneNumber") {
    return normalizePhoneNumber(oldValue) !== normalizePhoneNumber(nextValue);
  }

  return hasMeaningfulDifference(oldValue, nextValue);
}
