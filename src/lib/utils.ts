import type { CleanupField } from "@/lib/types";

const fieldLabels: Record<CleanupField, string> = {
  companyName: "Company Name",
  website: "Website",
  billingAddress: "Billing Address",
  phoneNumber: "Phone Number",
  employeeCount: "Employee Count",
  primaryContactName: "Primary Contact",
  primaryContactTitle: "Primary Contact Title",
  primaryContactEmail: "Primary Contact Email",
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function formatFieldLabel(field: CleanupField) {
  return fieldLabels[field];
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeSalesforceValue(value: string | undefined | null) {
  const normalized = normalizeWhitespace(value ?? "");
  if (!normalized) {
    return "";
  }

  const tokens = normalized
    .split(",")
    .map((token) => normalizeWhitespace(token).toLowerCase());
  const placeholders = new Set([
    "--none--",
    "none",
    "not set",
    "null",
    "n/a",
    "na",
    "unknown",
  ]);

  if (tokens.every((token) => placeholders.has(token))) {
    return "";
  }

  return normalized;
}

export function normalizeForCompare(value: string) {
  return normalizeSalesforceValue(value).toLowerCase();
}

export function formatDisplayValue(value: string | undefined | null) {
  const normalized = normalizeSalesforceValue(value);
  return normalized || "Not set";
}

export function confidenceToPercent(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

export function confidenceTone(confidence: number) {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.65) return "medium";
  return "low";
}

export function domainFromUrl(value: string) {
  try {
    const prefixed = value.startsWith("http") ? value : `https://${value}`;
    return new URL(prefixed).hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/^www\./, "");
  }
}

export function humanizeDomain(domain: string) {
  const normalized = domainFromUrl(domain)
    .replace(/\.[a-z]{2,}$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  return normalized
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isLikelySalesforceHost(value: string) {
  const domain = domainFromUrl(value);
  return /(\.|^)lightning\.force\.com$/i.test(domain) || /(\.|^)salesforce\.com$/i.test(domain);
}

export function rootDomainToken(value: string) {
  const domain = domainFromUrl(value);
  return domain.split(".")[0] || "";
}

export function normalizeCompanyNameForMatch(value: string) {
  return normalizeSalesforceValue(value)
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(
      /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|gmbh|group|holdings)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function isLikelyPlaceholderName(value: string) {
  const normalized = normalizeForCompare(value);

  if (!normalized) {
    return true;
  }

  const placeholders = new Set([
    "home",
    "details",
    "related",
    "activity",
    "overview",
    "account",
    "accounts",
    "new",
    "edit",
  ]);

  return placeholders.has(normalized);
}

export function joinAddressParts(parts: Array<string | undefined | null>) {
  return parts
    .map((part) => normalizeSalesforceValue(part))
    .filter(Boolean)
    .join(", ");
}

export function toAbsoluteUrl(value: string) {
  if (!value) return "";

  try {
    return new URL(value).toString();
  } catch {
    return `https://${value.replace(/^\/*/, "")}`;
  }
}

export function parseLocationParts(value: string) {
  const cleaned = normalizeSalesforceValue(value);
  if (!cleaned) {
    return null;
  }

  const parts = cleaned
    .split(",")
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const country = parts.length >= 3 ? parts.at(-1) || "" : "";
  const regionAndPostal = parts.length >= 2 ? parts.at(-2) || "" : "";
  const city = parts.length >= 2 ? parts.at(-3) || parts[0] || "" : "";
  const street =
    parts.length >= 4 ? parts.slice(0, parts.length - 3).join(", ") : "";
  const postalMatch = regionAndPostal.match(/^(.*?)(?:\s+(\d[\dA-Za-z\- ]+))?$/);
  const stateOrRegion = normalizeWhitespace(postalMatch?.[1] || regionAndPostal);
  const postalCode = normalizeWhitespace(postalMatch?.[2] || "");

  return {
    street,
    city,
    stateOrRegion,
    postalCode,
    country,
  };
}

export function sanitizeNumericInput(value: string) {
  const match = value.replace(/[^\d]/g, "");
  return match || "";
}

export function normalizePhoneNumber(value: string) {
  const cleaned = normalizeSalesforceValue(value);
  if (!cleaned) {
    return "";
  }

  const digits = cleaned.replace(/[^\d+]/g, "");
  return digits || cleaned;
}
