import { act, type Action } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let action: Action;
  try {
    action = (await request.json()) as Action;
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON"] }, { status: 400 });
  }
  if (!["approve", "reject", "edit"].includes(action?.type)) {
    return Response.json({ ok: false, errors: ["Unknown action"] }, { status: 400 });
  }
  try {
    const result = await act(decodeURIComponent(id), action);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    return Response.json({ ok: false, errors: [(err as Error).message] }, { status: 409 });
  }
}
