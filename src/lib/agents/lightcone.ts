import Lightcone from "@tzafon/lightcone";

import type {
  FieldChange,
  SalesforceAccountSnapshot,
  SourceEvidence,
} from "@/lib/types";

export function getLightconeApiKey() {
  return process.env.TZAFON_API_KEY || process.env.LIGHTCONE_API_KEY || "";
}

export function hasNorthstarConfig() {
  return Boolean(getLightconeApiKey());
}

export function getNorthstarIntegrationNote() {
  if (!hasNorthstarConfig()) {
    return "Lightcone key not configured. Northstar review is unavailable.";
  }

  return "Lightcone is configured and reviews the browser-collected evidence before Salesforce writeback.";
}

export function getLightconeClient() {
  const apiKey = getLightconeApiKey();
  if (!apiKey) {
    throw new Error(
      "Lightcone is not configured. Set TZAFON_API_KEY or LIGHTCONE_API_KEY.",
    );
  }

  return new Lightcone({ apiKey });
}

function extractTextContent(messageContent: unknown) {
  if (typeof messageContent === "string") {
    return messageContent;
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const candidate = item as { text?: string; type?: string };
        return candidate.type === "text" || candidate.text ? candidate.text || "" : "";
      })
      .join("\n");
  }

  return "";
}

function buildEvidenceLookup(evidence: SourceEvidence[]) {
  return evidence.reduce<Record<string, SourceEvidence[]>>((acc, item) => {
    if (!acc[item.fieldSupported]) {
      acc[item.fieldSupported] = [];
    }

    acc[item.fieldSupported].push(item);
    return acc;
  }, {});
}

export async function reviewChangesWithLightcone(
  snapshot: SalesforceAccountSnapshot,
  proposedChanges: FieldChange[],
  evidence: SourceEvidence[],
) {
  const client = getLightconeClient();
  const evidenceByField = buildEvidenceLookup(evidence);

  const prompt = [
    "You are reviewing CRM cleanup suggestions before Salesforce writeback.",
    "Return strict JSON with this shape:",
    '{"summary":"string","changes":[{"field":"companyName","proposedValue":"string","confidence":0.0,"reasoning":"string","status":"proposed|unchanged|skipped","statusNote":"string"}]}',
    "Rules:",
    "- Only use fields that are present in the input candidates.",
    "- If evidence is weak, mark the field as skipped.",
    "- If the current Salesforce value already matches the evidence, mark unchanged.",
    "- Validate every field independently. Empty Salesforce fields should be populated when the evidence is strong enough.",
    "- For website changes, prefer the clearly official public domain over the currently stored Salesforce website if they conflict.",
    "- For company names, allow updates when the official branding or legal suffix differs from Salesforce.",
    "- For billing address, phone number, and employee count, require evidence from official pages or strong public corroboration.",
    "- Prefer conservative decisions over aggressive guesses.",
    "- Confidence must be between 0 and 1.",
    "",
    `Current Salesforce snapshot: ${JSON.stringify(snapshot)}`,
    `Candidate changes: ${JSON.stringify(
      proposedChanges.map((change) => ({
        field: change.field,
        oldValue: change.oldValue,
        proposedValue: change.proposedValue,
        currentStatus: change.status,
        currentReasoning: change.reasoning,
        evidence: (evidenceByField[change.field] || []).map((item) => ({
          title: item.title,
          url: item.url,
          extractedText: item.extractedText,
          confidence: item.confidence,
          notes: item.notes,
        })),
      })),
    )}`,
  ].join("\n");

  const result = (await client.chat.createCompletion({
    model: "tzafon.northstar-cua-fast",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  })) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  const raw = extractTextContent(result.choices?.[0]?.message?.content);
  const parsed = JSON.parse(raw) as {
    summary?: string;
    changes?: Array<{
      field: FieldChange["field"];
      proposedValue?: string;
      confidence?: number;
      reasoning?: string;
      status?: FieldChange["status"];
      statusNote?: string;
    }>;
  };

  const updatedChanges = proposedChanges.map((change) => {
    const reviewed = parsed.changes?.find((item) => item.field === change.field);
    if (!reviewed) {
      return change;
    }

    return {
      ...change,
      proposedValue: reviewed.proposedValue ?? change.proposedValue,
      confidence:
        typeof reviewed.confidence === "number"
          ? Math.max(0, Math.min(1, reviewed.confidence))
          : change.confidence,
      reasoning: reviewed.reasoning ?? change.reasoning,
      status:
        reviewed.status === "proposed" ||
        reviewed.status === "unchanged" ||
        reviewed.status === "skipped"
          ? reviewed.status
          : change.status,
      statusNote: reviewed.statusNote ?? change.statusNote,
    };
  });

  return {
    summary:
      parsed.summary ||
      "Lightcone reviewed the browser-collected evidence and finalized the Salesforce update recommendations.",
    changes: updatedChanges,
  };
}
