import { requireAppSession } from "../../../lib/app-auth";
import { apiError } from "../../../lib/api-errors";
import type { CopySettings } from "../../../lib/types";
import { getOrCreateCopySettings, saveCopySettings } from "../../../services/copy-monitor";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    return Response.json(await getOrCreateCopySettings(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "copy-settings.get"), { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const unauthorized = await requireAppSession(request);
    if (unauthorized) return unauthorized;
    const settings = await request.json() as CopySettings;
    return Response.json(await saveCopySettings(settings), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(apiError(error, "copy-settings.save"), { status: 400 });
  }
}
