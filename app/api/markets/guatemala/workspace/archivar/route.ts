import { NextRequest, NextResponse } from "next/server";
import { authorizeGuatemalaRequest } from "@/lib/markets/guatemala-guard";
import {
  archiveGuatemalaWorkspaceCards,
  listConfirmedGuatemalaWorkspaceJobs,
} from "@/lib/markets/guatemala-workspace-archive-store";
import { WORKSPACE_ARCHIVE_MESSAGES } from "@/lib/markets/guatemala-workspace-archive";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorizeGuatemalaRequest(
    request,
    request.nextUrl.searchParams.get("clientId") ?? "",
    "write"
  );
  if (!access.ok) return access.response;
  try {
    const confirmedJobIds = await listConfirmedGuatemalaWorkspaceJobs(access.clientId);
    return NextResponse.json({ ok: true, confirmedJobIds });
  } catch (error) {
    console.error("[guatemala/workspace/archivar] list failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: WORKSPACE_ARCHIVE_MESSAGES.failed }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: WORKSPACE_ARCHIVE_MESSAGES.failed }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as { clientId?: unknown; jobId?: unknown }) : {};
  const access = await authorizeGuatemalaRequest(request, String(record.clientId ?? ""), "write");
  if (!access.ok) return access.response;
  const jobId = typeof record.jobId === "string" ? record.jobId : undefined;
  try {
    const result = await archiveGuatemalaWorkspaceCards({ clientId: access.clientId, jobId });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, archivedIds: result.archivedIds, message: result.message });
  } catch (error) {
    console.error("[guatemala/workspace/archivar] archive failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ ok: false, error: WORKSPACE_ARCHIVE_MESSAGES.failed }, { status: 500 });
  }
}
