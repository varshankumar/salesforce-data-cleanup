import { runCleanup } from "@/lib/cleanup/engine";
import type { LoginChallenge } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        const run = await runCleanup(
          (steps) => {
            send("step", { steps });
          },
          (challenge: LoginChallenge) => {
            send("challenge", { challenge });
          },
          (session) => {
            send("session", { session });
          },
        );

        send("result", { run });
      } catch (error) {
        send("stream-error", {
          message:
            error instanceof Error ? error.message : "Cleanup failed unexpectedly.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
