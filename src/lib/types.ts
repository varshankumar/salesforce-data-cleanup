export type CleanupField =
  | "companyName"
  | "website"
  | "billingAddress"
  | "phoneNumber"
  | "employeeCount"
  | "primaryContactName"
  | "primaryContactTitle"
  | "primaryContactEmail";

export interface SourceEvidence {
  url: string;
  title: string;
  extractedText: string;
  fieldSupported: CleanupField;
  confidence: number;
  notes: string;
}

export interface FieldChange {
  field: CleanupField;
  label: string;
  salesforceLabels: string[];
  oldValue: string;
  proposedValue: string;
  finalValue?: string;
  confidence: number;
  reasoning: string;
  status: "proposed" | "applied" | "skipped" | "unchanged" | "failed";
  statusNote: string;
  sources: SourceEvidence[];
}

export type CleanupStepKey =
  | "opening-browser"
  | "signing-into-salesforce"
  | "reading-salesforce-record"
  | "researching-public-web"
  | "comparing-evidence"
  | "updating-salesforce"
  | "verifying-record"
  | "writing-report";

export type CleanupStepStatus = "pending" | "active" | "completed" | "error";

export interface CleanupTimelineStep {
  key: CleanupStepKey;
  label: string;
  status: CleanupStepStatus;
  note?: string;
  timestamp?: string;
}

export interface LoginChallenge {
  runId: string;
  type: "salesforce-email-code";
  message: string;
}

export interface BrowserSessionSummary {
  provider: "local-playwright" | "kernel-cdp";
  sessionId: string;
  tracePath?: string;
  liveUrl?: string;
  replayUrl?: string;
}

export interface SalesforceAccountSnapshot {
  recordUrl: string;
  companyName: string;
  website: string;
  billingAddress: string;
  phoneNumber: string;
  employeeCount: string;
  primaryContactName: string;
  primaryContactTitle: string;
  primaryContactEmail: string;
  capturedAt: string;
}

export interface CleanupRun {
  id: string;
  status: "completed" | "failed";
  mode: "salesforce-browser-live";
  summary: string;
  createdAt: string;
  completedAt: string;
  salesforceRecordUrl: string;
  steps: CleanupTimelineStep[];
  before: SalesforceAccountSnapshot | null;
  after: SalesforceAccountSnapshot | null;
  evidence: SourceEvidence[];
  changes: FieldChange[];
  session: BrowserSessionSummary;
  errorMessage?: string;
}

export interface BrowserResearchResult {
  summary: string;
  evidence: SourceEvidence[];
  changes: FieldChange[];
  consultedUrls: string[];
}
