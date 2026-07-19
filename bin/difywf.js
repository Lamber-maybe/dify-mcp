#!/usr/bin/env node
// Requires Node >= 23.6 (native TypeScript type stripping).
import { main } from "../src/cli.ts";
main().catch((e) => {
  process.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(10);
});
