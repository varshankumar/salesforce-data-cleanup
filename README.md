# CRM Autopilot

CRM Autopilot is a one-button Salesforce cleanup app built around the hackathon stack: Kernel provides the browser session, Lightcone/Northstar reviews the browser-collected evidence, and the app orchestrates Salesforce login, writeback, verification, and reporting.

## What The App Does

- Uses Salesforce as the live CRM source instead of seeded mock data.
- Launches a Kernel browser session and connects automation into it over CDP.
- Logs into Salesforce, opens a configured Account record, and captures the current state.
- Researches public company sources in browser tabs.
- Uses Lightcone/Northstar to review proposed field updates from the browser-collected evidence.
- Writes supported changes back into Salesforce, reloads the record, and verifies the final state.
- Stores a final report with:
  - Before snapshot
  - After snapshot
  - Field-by-field outcomes
  - Public evidence
  - Execution timeline
  - Kernel session metadata

## Why It Fits CUA Applications

- Kernel is on the browser-runtime path.
- Lightcone/Northstar is on the decision path.
- Salesforce login and writeback happen through browser automation.
- The user gives one approval by pressing `Start Cleanup`.
- The final report makes the computer-use work legible after execution.

## Current Architecture

- `src/app/page.tsx`
  Single-button launcher UI with readiness gating.
- `src/app/api/cleanup/stream/route.ts`
  SSE endpoint that runs cleanup and streams progress.
- `src/app/runs/[id]/page.tsx`
  Final cleanup report page.
- `src/lib/cleanup/engine.ts`
  End-to-end orchestration.
- `src/lib/agents/browser-session.ts`
  Kernel-backed browser session creation and CDP connection.
- `src/lib/agents/browser-research.ts`
  Public web research plus candidate change generation.
- `src/lib/agents/lightcone.ts`
  Lightcone/Northstar review of candidate changes.
- `src/lib/agents/salesforce.ts`
  Salesforce login, scrape, writeback, and verification.
- `data/cleanup-runs.json`
  Stored run history.

## Required API Keys

Yes. For the primary hackathon flow you need both:

- `KERNEL_API_KEY`
- `TZAFON_API_KEY`

The app also accepts `LIGHTCONE_API_KEY` as an alias, but `TZAFON_API_KEY` is the official Lightcone SDK environment variable.

You also need the Salesforce values:

- `SALESFORCE_LOGIN_URL`
- `SALESFORCE_USERNAME`
- `SALESFORCE_PASSWORD`
- `SALESFORCE_ACCOUNT_URL`

## How Kernel Is Used

Kernel is the browser provider.

- The app creates a remote browser with `@onkernel/sdk`.
- It connects Playwright to the Kernel browser using the returned CDP websocket URL.
- The cleanup report stores Kernel session identifiers and live-view metadata when available.

Kernel’s docs describe this browser role and the CDP connection model here:
- https://www.kernel.sh/docs/
- https://docs.lightcone.ai/integrations/kernel/

## How Lightcone / Northstar Is Used

Lightcone/Northstar is the model layer.

- Browser automation gathers evidence from public sources.
- Candidate field updates are generated from that evidence.
- Lightcone reviews those candidates, adjusts confidence, and decides whether each should remain proposed, be skipped, or be marked unchanged.

This is narrower than a full screenshot-action CUA loop, but it puts Lightcone on the actual decision path today and keeps the Salesforce flow stable.

Relevant docs:
- https://docs.lightcone.ai/guides/chat-completions
- https://docs.lightcone.ai/guides/tasks
- https://docs.lightcone.ai/integrations/kernel/

## Do You Need A Secondary LLM?

No. Not for this version.

- Kernel handles browser infrastructure.
- Lightcone handles model-side review.
- A second model like Gemini is optional and only makes sense if you later want a separate arbitration or enrichment layer.

## Salesforce Assumptions

- The configured record is a Salesforce Lightning Account page.
- The test user can complete login without MFA blocking automation.
- Standard Account fields work best:
  - Account Name
  - Website
  - Billing Address
  - Employees
- Primary contact fields are optional and may need custom label env vars if your layout uses different names.

## Environment Variables

Required:

- `KERNEL_API_KEY`
- `TZAFON_API_KEY`
- `SALESFORCE_LOGIN_URL`
- `SALESFORCE_USERNAME`
- `SALESFORCE_PASSWORD`
- `SALESFORCE_ACCOUNT_URL`

Optional:

- `LIGHTCONE_API_KEY`
- `SALESFORCE_PRIMARY_CONTACT_NAME_LABEL`
- `SALESFORCE_PRIMARY_CONTACT_TITLE_LABEL`
- `SALESFORCE_PRIMARY_CONTACT_EMAIL_LABEL`
- `PLAYWRIGHT_HEADLESS`

## How To Run Locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Install Chromium for Playwright’s CDP client:

   ```bash
   npm run install:browsers
   ```

3. Copy the environment template:

   ```bash
   cp .env.example .env.local
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env.local
   ```

4. Fill in `.env.local` with Kernel, Lightcone, and Salesforce credentials.

5. Start the app:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000` and press `Start Cleanup`.

## Resetting Stored Reports

The app only stores cleanup run history.

```bash
npm run reset:data
```

## Notes On Reliability

- Salesforce layouts vary by org customization.
- Public web research is noisy by nature.
- Billing Address writeback only happens when the researched headquarters value is structured enough to map into Salesforce address fields.
- Employee count updates are treated as directional unless a clean numeric signal is available.

## Future Work

- Move the public-web research stage from browser-plus-review into a full Lightcone computer-use loop.
- Use Kernel replay URLs directly in the final report.
- Support batch cleanup across multiple Salesforce records.
- Persist screenshots alongside the run history.
