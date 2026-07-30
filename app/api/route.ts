export async function GET() {
  return Response.json({
    ok: true,
    service: "NEXT-TRADE",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
}
