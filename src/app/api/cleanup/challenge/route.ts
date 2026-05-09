import { resolveChallengeResponse } from "@/lib/cleanup/challenge-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    runId?: string;
    code?: string;
  };

  if (!body.runId || !body.code?.trim()) {
    return Response.json(
      { ok: false, error: "runId and code are required." },
      { status: 400 },
    );
  }

  const resolved = resolveChallengeResponse(body.runId, body.code.trim());
  if (!resolved) {
    return Response.json(
      { ok: false, error: "No pending login challenge was found for this run." },
      { status: 404 },
    );
  }

  return Response.json({ ok: true });
}
