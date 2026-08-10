import { rmSync } from "node:fs";
import { resolve } from "node:path";

for (const directory of ["dist", ".vinext"]) {
  const target = resolve(process.cwd(), directory);
  rmSync(target, { recursive: true, force: true });
  console.info(`[NEXT-TRADE][build] removed ${target}`);
}
