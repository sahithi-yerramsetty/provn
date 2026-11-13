import { getState, rerun } from "@/lib/store";

export async function GET() {
  return Response.json(await getState());
}

// Re-run the engine (e.g. the daily job). Sent fans are protected by the ledger.
export async function POST() {
  return Response.json(await rerun());
}
