import { WORKER_URL } from "@/lib/constants";

export async function POST(request: Request) {
  const body = await request.json();

  const workerRes = await fetch(`${WORKER_URL}/api/run-ab-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!workerRes.ok || !workerRes.body) {
    return Response.json(
      { error: "Worker error" },
      { status: workerRes.status }
    );
  }

  return new Response(workerRes.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
