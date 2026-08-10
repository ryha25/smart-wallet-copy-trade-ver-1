export type ApiErrorPayload = {
  error: string;
  details: string;
  stack?: string;
};

export function apiError(error: unknown, context: string): ApiErrorPayload {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const cause = normalized.cause instanceof Error
    ? `${normalized.cause.name}: ${normalized.cause.message}`
    : normalized.cause
      ? String(normalized.cause)
      : "";
  const details = [
    `context=${context}`,
    `type=${normalized.name}`,
    cause ? `cause=${cause}` : "",
  ].filter(Boolean).join(", ");

  console.error(`[NEXT-TRADE][${context}]`, {
    message: normalized.message,
    details,
    stack: normalized.stack,
  });

  return {
    error: normalized.message || "予期しないエラーが発生しました",
    details,
    ...(process.env.NODE_ENV !== "production" || process.env.DEBUG_ERRORS === "true"
      ? { stack: normalized.stack }
      : {}),
  };
}
