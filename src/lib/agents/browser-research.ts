import type { BrowserContext, Page } from "playwright";

import type {
  BrowserResearchResult,
  FieldChange,
  SalesforceAccountSnapshot,
  SourceEvidence,
} from "@/lib/types";
import {
  domainFromUrl,
  humanizeDomain,
  isLikelyPlaceholderName,
  isLikelySalesforceHost,
  normalizeCompanyNameForMatch,
  normalizePhoneNumber,
  normalizeSalesforceValue,
  normalizeWhitespace,
  rootDomainToken,
  toAbsoluteUrl,
} from "@/lib/utils";

import {
  buildNoChangeEntries,
  getSalesforceFieldMetadata,
  hasFieldMeaningfulDifference,
  replaceChange,
} from "@/lib/agents/salesforce";
import {
  hasNorthstarConfig,
  reviewChangesWithLightcone,
} from "@/lib/agents/lightcone";

interface SearchHit {
  query: string;
  title: string;
  url: string;
  snippet: string;
}

interface StructuredOrganization {
  name: string;
  url: string;
  telephone: string;
  email: string;
  address: string;
  employeeCount: string;
}

interface PageSignals {
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string;
  title: string;
  h1: string;
  bodyText: string;
  mailto: string;
  telephone: string;
  usefulLinks: Array<{ text: string; href: string }>;
  organizations: StructuredOrganization[];
  statusHint: "ok" | "dead";
}

interface SiteCandidate {
  url: string;
  score: number;
  signals: PageSignals;
}

const blockedWebsiteDomains = new Set([
  "bing.com",
  "duckduckgo.com",
  "search.brave.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "wikipedia.org",
  "crunchbase.com",
  "zoominfo.com",
  "bloomberg.com",
]);

function makeEvidence(
  fieldSupported: SourceEvidence["fieldSupported"],
  url: string,
  title: string,
  extractedText: string,
  confidence: number,
  notes: string,
): SourceEvidence {
  return {
    url,
    title,
    extractedText,
    fieldSupported,
    confidence,
    notes,
  };
}

function firstNonEmpty(values: Array<string | undefined>) {
  return values.map((value) => normalizeSalesforceValue(value ?? "")).find(Boolean) || "";
}

function dedupeStrings(values: string[]) {
  return Array.from(
    new Set(
      values.map((value) => normalizeWhitespace(value)).filter(Boolean),
    ),
  );
}

function normalizeUrlOrigin(value: string) {
  try {
    const url = new URL(toAbsoluteUrl(value));
    return `${url.protocol}//${url.hostname}/`;
  } catch {
    return "";
  }
}

function isUsableCompanySeed(value: string) {
  const normalized = normalizeSalesforceValue(value);
  if (!normalized || isLikelyPlaceholderName(normalized)) {
    return false;
  }

  return normalized.split(" ").length <= 8;
}

function summarizeCounts(changes: FieldChange[]) {
  const proposed = changes.filter((change) => change.status === "proposed").length;
  const unchanged = changes.filter(
    (change) => change.status === "unchanged",
  ).length;
  const skipped = changes.filter((change) => change.status === "skipped").length;

  return { proposed, unchanged, skipped };
}

function isLikelyOfficialWebsiteCandidate(url: string) {
  const domain = domainFromUrl(url);
  if (!domain || isLikelySalesforceHost(url)) {
    return false;
  }

  return !Array.from(blockedWebsiteDomains).some(
    (blocked) => domain === blocked || domain.endsWith(`.${blocked}`),
  );
}

function companyNameMatches(companyNeedle: string, candidate: string) {
  const normalizedCandidate = normalizeCompanyNameForMatch(candidate);
  if (!companyNeedle || !normalizedCandidate) {
    return false;
  }

  return (
    normalizedCandidate.includes(companyNeedle) ||
    companyNeedle.includes(normalizedCandidate)
  );
}

async function safeEvaluateAll<T, A>(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  mapper: (nodes: Array<HTMLElement | SVGElement>, arg: unknown) => T,
  arg: A,
): Promise<T> {
  try {
    return await locator.evaluateAll(mapper, arg);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (!message.includes("Execution context was destroyed")) {
      throw error;
    }

    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
    return locator.evaluateAll(mapper, arg);
  }
}

async function searchDuckDuckGo(page: Page, query: string): Promise<SearchHit[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(800);
  } catch {
    return [];
  }

  return safeEvaluateAll(
    page,
    page.locator(".result"),
    (nodes, currentQuery) =>
      nodes
        .slice(0, 6)
        .map((node) => {
          const link = node.querySelector(".result__title a") as HTMLAnchorElement | null;
          const snippet = node.querySelector(".result__snippet");

          return {
            query: String(currentQuery || ""),
            title: link?.textContent?.trim() || "",
            url: link?.href || "",
            snippet: snippet?.textContent?.trim() || "",
          };
        })
        .filter((item) => item.url),
    query,
  );
}

async function searchBing(page: Page, query: string): Promise<SearchHit[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(800);
  } catch {
    return [];
  }

  return safeEvaluateAll(
    page,
    page.locator("li.b_algo"),
    (nodes, currentQuery) =>
      nodes
        .slice(0, 6)
        .map((node) => {
          const link = node.querySelector("h2 a") as HTMLAnchorElement | null;
          const snippet = node.querySelector(".b_caption p");

          return {
            query: String(currentQuery || ""),
            title: link?.textContent?.trim() || "",
            url: link?.href || "",
            snippet: snippet?.textContent?.trim() || "",
          };
        })
        .filter((item) => item.url),
    query,
  );
}

async function searchBrave(page: Page, query: string): Promise<SearchHit[]> {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(800);
  } catch {
    return [];
  }

  return safeEvaluateAll(
    page,
    page.locator(".snippet"),
    (nodes, currentQuery) =>
      nodes
        .slice(0, 6)
        .map((node) => {
          const link = node.querySelector("a") as HTMLAnchorElement | null;
          const title = node.querySelector(".title");
          const description = node.querySelector(".description");

          return {
            query: String(currentQuery || ""),
            title: title?.textContent?.trim() || link?.textContent?.trim() || "",
            url: link?.href || "",
            snippet: description?.textContent?.trim() || "",
          };
        })
        .filter((item) => item.url),
    query,
  );
}

async function searchWeb(page: Page, query: string) {
  const searchFns = [searchDuckDuckGo, searchBing, searchBrave];

  for (const searchFn of searchFns) {
    const results = await searchFn(page, query);
    if (results.length > 0) {
      return results;
    }
  }

  return [];
}

async function extractPageSignals(page: Page, url: string): Promise<PageSignals> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1200);
  } catch {
    return {
      requestedUrl: url,
      finalUrl: "",
      canonicalUrl: "",
      title: "",
      h1: "",
      bodyText: "",
      mailto: "",
      telephone: "",
      usefulLinks: [],
      organizations: [],
      statusHint: "dead",
    };
  }

  return page.evaluate((requestedUrl) => {
    const normalize = (value: unknown) =>
      typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

    const flattenJsonLd = (input: unknown): Array<Record<string, unknown>> => {
      if (!input) {
        return [];
      }

      if (Array.isArray(input)) {
        return input.flatMap(flattenJsonLd);
      }

      if (typeof input !== "object") {
        return [];
      }

      const record = input as Record<string, unknown>;
      const graph = Array.isArray(record["@graph"])
        ? (record["@graph"] as unknown[]).flatMap(flattenJsonLd)
        : [];

      return [record, ...graph];
    };

    const looksLikeOrganization = (value: unknown) => {
      const types = Array.isArray(value) ? value : [value];
      return types.some((item) =>
        /organization|corporation|brand|localbusiness|store|manufacturer/i.test(
          String(item || ""),
        ),
      );
    };

    const extractAddress = (value: unknown) => {
      if (!value || typeof value !== "object") {
        return "";
      }

      const record = value as Record<string, unknown>;
      return [
        record.streetAddress,
        record.addressLocality,
        record.addressRegion,
        record.postalCode,
        record.addressCountry,
      ]
        .map(normalize)
        .filter(Boolean)
        .join(", ");
    };

    const extractEmployeeCount = (value: unknown) => {
      if (typeof value === "string" || typeof value === "number") {
        return normalize(String(value));
      }

      if (!value || typeof value !== "object") {
        return "";
      }

      const record = value as Record<string, unknown>;
      return normalize(String(record.value || record.name || ""));
    };

    const scripts = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    );
    const organizations = scripts
      .flatMap((script) => {
        try {
          return flattenJsonLd(JSON.parse(script.textContent || "null"));
        } catch {
          return [];
        }
      })
      .filter((item) => looksLikeOrganization(item["@type"]))
      .map((item) => ({
        name: normalize(item.name),
        url: normalize(item.url),
        telephone: normalize(item.telephone),
        email: normalize(item.email),
        address: extractAddress(item.address),
        employeeCount: extractEmployeeCount(item.numberOfEmployees),
      }))
      .filter(
        (item) =>
          item.name ||
          item.url ||
          item.telephone ||
          item.email ||
          item.address ||
          item.employeeCount,
      );

    const bodyText = normalize(document.body.innerText).slice(0, 12000);
    const phoneFromText =
      bodyText.match(
        /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/,
      )?.[0] || "";
    const phoneFromTel = Array.from(
      document.querySelectorAll('a[href^="tel:"]'),
    )
      .map((element) =>
        normalize(
          (element as HTMLAnchorElement).getAttribute("href")?.replace(/^tel:/i, "") ||
            "",
        ),
      )
      .find(Boolean);
    const mailto = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
      .map((element) =>
        normalize(
          (element as HTMLAnchorElement)
            .getAttribute("href")
            ?.replace(/^mailto:/i, "") || "",
        ),
      )
      .find(Boolean);

    const usefulLinks = Array.from(document.querySelectorAll("a[href]"))
      .map((element) => ({
        text: normalize(element.textContent),
        href: (element as HTMLAnchorElement).href,
      }))
      .filter(
        (element) =>
          /about|company|leadership|team|contact|support|headquarters/i.test(
            element.text,
          ) && /^https?:/i.test(element.href),
      )
      .slice(0, 8);

    const statusHint = /404|not found|for sale|coming soon|parked domain/i.test(
      `${document.title} ${bodyText}`.slice(0, 4000),
    )
      ? "dead"
      : "ok";

    return {
      requestedUrl,
      finalUrl: window.location.href,
      canonicalUrl:
        normalize(
          document
            .querySelector("link[rel='canonical']")
            ?.getAttribute("href") || "",
        ) || window.location.href,
      title: normalize(document.title),
      h1: normalize(document.querySelector("h1")?.textContent || ""),
      bodyText,
      mailto: mailto || "",
      telephone: phoneFromTel || phoneFromText,
      usefulLinks,
      organizations,
      statusHint,
    };
  }, url);
}

function scoreOfficialSiteCandidate(
  snapshot: SalesforceAccountSnapshot,
  companySearchSeed: string,
  candidateUrl: string,
  signals: PageSignals,
) {
  const companyNeedle = normalizeCompanyNameForMatch(
    companySearchSeed || snapshot.companyName,
  );
  const normalizedDomain = normalizeCompanyNameForMatch(
    rootDomainToken(candidateUrl),
  );
  const siteNames = dedupeStrings([
    ...signals.organizations.map((organization) => organization.name),
    signals.h1,
    ...signals.title.split(/[|\-:]/).map((segment) => segment.trim()),
  ]);
  const domainMatches =
    companyNeedle && companyNameMatches(companyNeedle, normalizedDomain);
  const nameMatches =
    companyNeedle &&
    siteNames.some((name) => companyNameMatches(companyNeedle, name));

  let score = 0;

  if (signals.statusHint === "dead") {
    score -= 80;
  } else {
    score += 20;
  }

  if (domainMatches) {
    score += 22;
  }

  if (nameMatches) {
    score += 35;
  }

  if (companyNeedle && !domainMatches && !nameMatches) {
    score -= 45;
  }

  if (signals.organizations.some((organization) => organization.url)) {
    score += 8;
  }

  if (signals.organizations.some((organization) => organization.address)) {
    score += 8;
  }

  if (signals.mailto || signals.telephone) {
    score += 6;
  }

  if (signals.usefulLinks.length > 0) {
    score += 4;
  }

  if (
    normalizeSalesforceValue(snapshot.website) &&
    domainFromUrl(snapshot.website) === domainFromUrl(candidateUrl)
  ) {
    score += 6;
  }

  return score;
}

function extractCompanyNameFromSite(
  snapshot: SalesforceAccountSnapshot,
  signals: PageSignals,
) {
  const fallback = normalizeSalesforceValue(snapshot.companyName);
  const titleSegments = signals.title
    .split(/[|\-:]/)
    .map((segment) => normalizeSalesforceValue(segment))
    .filter(Boolean);
  const companyNeedle = normalizeCompanyNameForMatch(fallback);

  const structuredName = signals.organizations
    .map((organization) => organization.name)
    .find((name) => companyNameMatches(companyNeedle, name));

  if (structuredName) {
    return structuredName;
  }

  const titleName = titleSegments.find((segment) =>
    companyNameMatches(companyNeedle, segment),
  );
  if (titleName) {
    return titleName;
  }

  if (
    signals.h1 &&
    signals.h1.split(" ").length <= 6 &&
    !isLikelyPlaceholderName(signals.h1)
  ) {
    return signals.h1;
  }

  return fallback;
}

function extractHeadquartersFromText(texts: string[]) {
  const patterns = [
    /(\d{2,6} [A-Z0-9][^,]{2,80},\s*[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?(?:,\s*[A-Z][A-Za-z .'-]+)?)/,
    /headquartered in ([A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+)/i,
    /based in ([A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+)/i,
    /located in ([A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+)/i,
  ];

  for (const text of texts) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return normalizeSalesforceValue(match[1]);
      }
    }
  }

  return "";
}

function extractEmployeeCountFromText(texts: string[]) {
  const patterns = [
    /([\d,]{3,})\+?\s+employees/i,
    /over\s+([\d,]{3,})\s+employees/i,
    /approximately\s+([\d,]{3,})\s+employees/i,
    /(\d{1,3},?\d{0,3})\s*-\s*(\d{1,3},?\d{0,3})\s+employees/i,
  ];

  for (const text of texts) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return normalizeSalesforceValue(match[1]);
      }
    }
  }

  return "";
}

function extractExecutiveFromText(texts: string[]) {
  for (const text of texts) {
    const match = text.match(
      /([A-Z][a-z]+ [A-Z][a-z]+)\s+(?:is|serves as|,)\s+(Chief Executive Officer|CEO|Chief Operating Officer|Chief Revenue Officer|President)/i,
    );

    if (match?.[1] && match?.[2]) {
      return {
        name: normalizeSalesforceValue(match[1]),
        title:
          normalizeWhitespace(match[2]).toLowerCase() === "ceo"
            ? "Chief Executive Officer"
            : normalizeSalesforceValue(match[2]),
      };
    }
  }

  return null;
}

function extractAddressFromOrganizations(
  organizations: StructuredOrganization[],
  fallbackTexts: string[],
) {
  const structuredAddress = organizations
    .map((organization) => organization.address)
    .find(Boolean);

  return structuredAddress || extractHeadquartersFromText(fallbackTexts);
}

function extractPhoneFromOrganizations(
  organizations: StructuredOrganization[],
  fallbackTexts: string[],
) {
  const structuredPhone = organizations
    .map((organization) => organization.telephone)
    .find(Boolean);

  if (structuredPhone) {
    return normalizePhoneNumber(structuredPhone);
  }

  for (const text of fallbackTexts) {
    const match = text.match(
      /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/,
    );
    if (match?.[0]) {
      return normalizePhoneNumber(match[0]);
    }
  }

  return "";
}

function createChange(
  snapshot: SalesforceAccountSnapshot,
  field: FieldChange["field"],
  proposedValue: string,
  confidence: number,
  reasoning: string,
  sources: SourceEvidence[],
) {
  const metadata = getSalesforceFieldMetadata().find((item) => item.field === field);
  const oldValue = normalizeSalesforceValue(snapshot[field]);

  if (!metadata) {
    throw new Error(`Missing field metadata for ${field}`);
  }

  const normalizedProposed =
    field === "website"
      ? normalizeUrlOrigin(proposedValue)
      : field === "phoneNumber"
        ? normalizePhoneNumber(proposedValue)
        : normalizeSalesforceValue(proposedValue);

  if (!normalizedProposed) {
    return {
      field,
      label: metadata.label,
      salesforceLabels: metadata.salesforceLabels,
      oldValue,
      proposedValue: oldValue,
      confidence,
      reasoning,
      status: "skipped" as const,
      statusNote: "No reliable public evidence was strong enough to support an update.",
      sources,
    };
  }

  if (!hasFieldMeaningfulDifference(field, oldValue, normalizedProposed)) {
    return {
      field,
      label: metadata.label,
      salesforceLabels: metadata.salesforceLabels,
      oldValue,
      proposedValue: normalizedProposed,
      confidence,
      reasoning,
      status: "unchanged" as const,
      statusNote: "Public evidence matched the current Salesforce value.",
      sources,
      finalValue: oldValue,
    };
  }

  return {
    field,
    label: metadata.label,
    salesforceLabels: metadata.salesforceLabels,
    oldValue,
    proposedValue: normalizedProposed,
    confidence,
    reasoning,
    status: "proposed" as const,
    statusNote: "Public evidence suggests a Salesforce update.",
    sources,
  };
}

function buildCompanySearchSeed(snapshot: SalesforceAccountSnapshot) {
  const candidates = [
    normalizeSalesforceValue(snapshot.companyName),
    humanizeDomain(snapshot.website),
  ].filter(Boolean);

  return candidates.find((candidate) => isUsableCompanySeed(candidate)) || "";
}

async function selectOfficialSiteCandidate(
  page: Page,
  snapshot: SalesforceAccountSnapshot,
  companySearchSeed: string,
  hits: SearchHit[],
) {
  const candidateUrls = dedupeStrings(
    [
      normalizeSalesforceValue(snapshot.website),
      ...hits.map((hit) => hit.url),
    ]
      .map((url) => normalizeUrlOrigin(url))
      .filter((url) => isLikelyOfficialWebsiteCandidate(url)),
  ).slice(0, 6);

  const scoredCandidates: SiteCandidate[] = [];

  for (const candidateUrl of candidateUrls) {
    const signals = await extractPageSignals(page, candidateUrl);
    const score = scoreOfficialSiteCandidate(
      snapshot,
      companySearchSeed,
      candidateUrl,
      signals,
    );

    scoredCandidates.push({
      url: normalizeUrlOrigin(signals.canonicalUrl || signals.finalUrl || candidateUrl),
      score,
      signals,
    });
  }

  const bestCandidate =
    scoredCandidates.sort((left, right) => right.score - left.score)[0] || null;

  if (!bestCandidate || bestCandidate.score < 18) {
    return null;
  }

  return bestCandidate;
}

export async function researchCompanyWithBrowser(
  context: BrowserContext,
  snapshot: SalesforceAccountSnapshot,
): Promise<BrowserResearchResult> {
  const page = await context.newPage();
  const changes = buildNoChangeEntries(snapshot);
  const evidence: SourceEvidence[] = [];
  const consultedUrls = new Set<string>();
  const companySearchSeed = buildCompanySearchSeed(snapshot);
  const usableWebsiteSeed =
    normalizeSalesforceValue(snapshot.website) &&
    !isLikelySalesforceHost(snapshot.website)
      ? normalizeUrlOrigin(snapshot.website)
      : "";

  if (!companySearchSeed && !usableWebsiteSeed) {
    await page.close();

    const blockedChanges = changes.map((change) => ({
      ...change,
      confidence: 0,
      status: "skipped" as const,
      statusNote:
        "Salesforce did not expose a reliable company name or website, so browser research was intentionally skipped.",
      reasoning:
        "The CRM snapshot did not provide a trustworthy seed for public-web research.",
    }));

    return {
      summary:
        "Cleanup skipped public research because the Salesforce snapshot did not expose a reliable company name or website seed.",
      evidence,
      changes: blockedChanges,
      consultedUrls: [],
    };
  }

  const searchQueries = companySearchSeed
    ? [
        `${companySearchSeed} official website`,
        `${companySearchSeed} billing address`,
        `${companySearchSeed} phone number`,
        `${companySearchSeed} employee count`,
        `${companySearchSeed} leadership`,
      ]
    : [];

  const queryResults =
    searchQueries.length > 0
      ? await Promise.all(
          searchQueries.map(async (query) => ({
            query,
            hits: await searchWeb(page, query),
          })),
        )
      : [];

  const allHits = queryResults.flatMap((entry) => entry.hits);
  const selectedSite = await selectOfficialSiteCandidate(
    page,
    snapshot,
    companySearchSeed,
    allHits,
  );

  if (!selectedSite) {
    await page.close();

    const unresolvedChanges = changes.map((change) => ({
      ...change,
      confidence: 0.2,
      status: "skipped" as const,
      statusNote:
        "Search results did not produce a trustworthy official company website to validate against.",
      reasoning:
        "The browser session could not identify an official public web source with enough confidence to compare against Salesforce.",
    }));

    return {
      summary:
        "Browser research ran, but it could not establish a trustworthy official website to validate the Salesforce account.",
      evidence,
      changes: unresolvedChanges,
      consultedUrls: [],
    };
  }

  const officialUrl = normalizeUrlOrigin(selectedSite.url || usableWebsiteSeed);
  const officialSignals = selectedSite.signals;
  consultedUrls.add(officialUrl);

  const officialDomain = domainFromUrl(officialUrl);
  const sameDomainSearchLinks = dedupeStrings(
    [
      ...officialSignals.usefulLinks.map((link) => link.href),
      ...allHits
        .filter((hit) => domainFromUrl(hit.url) === officialDomain)
        .map((hit) => hit.url),
    ]
      .map((url) => toAbsoluteUrl(url))
      .filter((url) => domainFromUrl(url) === officialDomain),
  ).slice(0, 4);

  const secondarySignals: PageSignals[] = [];
  for (const link of sameDomainSearchLinks) {
    if (normalizeUrlOrigin(link) === officialUrl) {
      continue;
    }

    consultedUrls.add(link);
    secondarySignals.push(await extractPageSignals(page, link));
  }

  const allOrganizations = [
    ...officialSignals.organizations,
    ...secondarySignals.flatMap((signal) => signal.organizations),
  ];
  const searchSnippets = allHits
    .map((hit) => normalizeSalesforceValue(hit.snippet))
    .filter(Boolean);
  const allTexts = [
    officialSignals.bodyText,
    ...secondarySignals.map((signal) => signal.bodyText),
    ...searchSnippets,
  ].filter(Boolean);

  const companyNameCandidate = extractCompanyNameFromSite(snapshot, officialSignals);
  const websiteCandidate = firstNonEmpty([
    officialSignals.organizations.find((organization) => organization.url)?.url,
    officialSignals.canonicalUrl,
    officialUrl,
  ]);
  const billingAddressCandidate = extractAddressFromOrganizations(
    allOrganizations,
    allTexts,
  );
  const phoneCandidate = extractPhoneFromOrganizations(allOrganizations, allTexts);
  const employeeCountCandidate = firstNonEmpty([
    allOrganizations
      .map((organization) => organization.employeeCount)
      .find(Boolean),
    extractEmployeeCountFromText(allTexts),
  ]);
  const executiveCandidate = extractExecutiveFromText(allTexts);
  const emailCandidate = firstNonEmpty([
    officialSignals.organizations.find((organization) => organization.email)?.email,
    officialSignals.mailto,
    ...secondarySignals.map((signal) => signal.mailto),
  ]);

  const companyEvidence = makeEvidence(
    "companyName",
    officialUrl,
    officialSignals.title || "Official website",
    firstNonEmpty([
      allOrganizations.find((organization) => organization.name)?.name,
      officialSignals.h1,
      officialSignals.title,
      snapshot.companyName,
    ]),
    0.84,
    "Official-site branding and structured organization metadata were used to validate the Salesforce account name, including suffix changes.",
  );
  evidence.push(companyEvidence);
  changes.splice(
    0,
    changes.length,
    ...replaceChange(
      changes,
      createChange(
        snapshot,
        "companyName",
        companyNameCandidate,
        0.84,
        "Official-site branding was compared against the Salesforce account name to detect renames and suffix mismatches.",
        [companyEvidence],
      ),
    ),
  );

  const websiteEvidence = makeEvidence(
    "website",
    officialUrl,
    officialSignals.title || "Official website",
    normalizeUrlOrigin(websiteCandidate),
    0.94,
    normalizeSalesforceValue(snapshot.website)
      ? "The current Salesforce website was validated against the highest-confidence official public domain."
      : "The official public website was identified from search results and validated directly in the browser.",
  );
  evidence.push(websiteEvidence);
  changes.splice(
    0,
    changes.length,
    ...replaceChange(
      changes,
      createChange(
        snapshot,
        "website",
        websiteCandidate,
        0.94,
        "The official public web domain was checked directly instead of assuming the current Salesforce Website field was correct.",
        [websiteEvidence],
      ),
    ),
  );

  if (billingAddressCandidate) {
    const billingEvidence = makeEvidence(
      "billingAddress",
      officialUrl,
      "Official address signal",
      billingAddressCandidate,
      0.78,
      "Structured organization metadata and official contact pages were used to populate the Salesforce Billing Address field.",
    );
    evidence.push(billingEvidence);
    changes.splice(
      0,
      changes.length,
      ...replaceChange(
        changes,
        createChange(
          snapshot,
          "billingAddress",
          billingAddressCandidate,
          0.78,
          "Official public address signals were compared against the Salesforce Billing Address field.",
          [billingEvidence],
        ),
      ),
    );
  }

  if (phoneCandidate) {
    const phoneEvidence = makeEvidence(
      "phoneNumber",
      officialUrl,
      "Official contact signal",
      phoneCandidate,
      0.82,
      "Phone number came from official-site structured data, contact links, or visible contact copy.",
    );
    evidence.push(phoneEvidence);
    changes.splice(
      0,
      changes.length,
      ...replaceChange(
        changes,
        createChange(
          snapshot,
          "phoneNumber",
          phoneCandidate,
          0.82,
          "Official public contact information was compared against the Salesforce Phone field.",
          [phoneEvidence],
        ),
      ),
    );
  }

  if (employeeCountCandidate) {
    const employeeEvidence = makeEvidence(
      "employeeCount",
      allHits.find((hit) => /employee/i.test(hit.query))?.url || officialUrl,
      "Public workforce source",
      employeeCountCandidate,
      0.62,
      "Employee count was sourced from public snippets or structured data and treated as a directional estimate.",
    );
    evidence.push(employeeEvidence);
    changes.splice(
      0,
      changes.length,
      ...replaceChange(
        changes,
        createChange(
          snapshot,
          "employeeCount",
          employeeCountCandidate,
          0.62,
          "Public workforce signals were compared against the Salesforce employee-count field.",
          [employeeEvidence],
        ),
      ),
    );
  }

  if (executiveCandidate) {
    const executiveEvidence = makeEvidence(
      "primaryContactName",
      officialUrl,
      "Public leadership signal",
      `${executiveCandidate.name} - ${executiveCandidate.title}`,
      0.64,
      "Public leadership text on official pages or search snippets was used as a default contact suggestion.",
    );
    evidence.push(executiveEvidence);
    changes.splice(
      0,
      changes.length,
      ...replaceChange(
        changes,
        createChange(
          snapshot,
          "primaryContactName",
          executiveCandidate.name,
          0.64,
          "Public executive information was used to populate a missing named contact when Salesforce lacked one.",
          [executiveEvidence],
        ),
      ),
    );
    changes.splice(
      0,
      changes.length,
      ...replaceChange(
        changes,
        createChange(
          snapshot,
          "primaryContactTitle",
          executiveCandidate.title,
          0.64,
          "Public executive information was used to populate a missing contact title.",
          [executiveEvidence],
        ),
      ),
    );
  }

  if (emailCandidate) {
    const emailEvidence = makeEvidence(
      "primaryContactEmail",
      officialUrl,
      "Official contact route",
      emailCandidate,
      0.72,
      "Email came from a public mailto link or structured organization metadata on the official website.",
    );
    evidence.push(emailEvidence);
    changes.splice(
      0,
      changes.length,
      ...replaceChange(
        changes,
        createChange(
          snapshot,
          "primaryContactEmail",
          emailCandidate,
          0.72,
          "Public contact email was extracted from official company pages.",
          [emailEvidence],
        ),
      ),
    );
  }

  await page.close();

  const counts = summarizeCounts(changes);

  if (hasNorthstarConfig()) {
    try {
      const reviewed = await reviewChangesWithLightcone(
        snapshot,
        changes,
        evidence,
      );

      return {
        summary: reviewed.summary,
        evidence,
        changes: reviewed.changes,
        consultedUrls: Array.from(consultedUrls),
      };
    } catch {
      // Fall back to deterministic browser-derived changes if model review fails.
    }
  }

  return {
    summary:
      counts.proposed > 0
        ? `Browser research validated ${changes.length} Salesforce fields and produced ${counts.proposed} proposed update${counts.proposed === 1 ? "" : "s"} from official public-web evidence.`
        : `Browser research validated ${changes.length} Salesforce fields and did not find a high-confidence update to write back.`,
    evidence,
    changes,
    consultedUrls: Array.from(consultedUrls),
  };
}
