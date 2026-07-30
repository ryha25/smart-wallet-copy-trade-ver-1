export const COPY_SOURCE_WALLET_LIMIT = Math.max(
  1,
  Number(
    process.env.NEXT_PUBLIC_COPY_SOURCE_WALLET_LIMIT
      ?? "30",
  ) || 30,
);
