import fs from "node:fs";
import { formatError, ResearchError } from "@/research/errors";

/**
 * Load .env for command-line tools (Next.js loads it itself for the web app).
 * Values already in the environment win, so `keysmith run -- <cmd>` can inject
 * real secrets over the keysmith:// placeholders the file holds.
 */
export function loadEnv(): void {
  if (fs.existsSync(".env")) {
    for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || line.trimStart().startsWith("#")) continue;
      const [, key, raw] = match;
      if (process.env[key] === undefined) process.env[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  // A placeholder that was not swapped for a real value counts as "not set".
  for (const [key, value] of Object.entries(process.env)) {
    if (value === "" || value?.startsWith("keysmith://")) delete process.env[key];
  }
}

/** Print an error in the standard one-line format and set a failing exit code. */
export function reportError(err: unknown): void {
  process.exitCode = 1;
  if (err instanceof ResearchError) {
    process.stderr.write(`${formatError(err)}\n`);
    return;
  }
  const code = (err as { code?: string })?.code;
  if (code === "DB_URL_MISSING") {
    process.stderr.write(`error[DB_URL_MISSING]: ${(err as Error).message}\n`);
    return;
  }
  if (code === "ECONNREFUSED" || (err as { cause?: { code?: string } })?.cause?.code === "ECONNREFUSED") {
    process.stderr.write(
      "error[DB_UNREACHABLE]: cannot connect using DATABASE_URL. fix: brew services start postgresql@17, then retry (retry after the fix; nothing written)\n",
    );
    return;
  }
  const trace = writeTrace(err);
  process.stderr.write(
    `error[WORKER_UNEXPECTED]: ${err instanceof Error ? err.message : String(err)}. trace: ${trace}. fix: run the command again with --verbose and report the trace (needs a person)\n`,
  );
  if (process.argv.includes("--verbose") && err instanceof Error) {
    process.stderr.write(`${err.stack}\n`);
  }
}

export function writeTrace(err: unknown, name = `error-${Date.now()}`): string {
  const file = `.logs/${name}.log`;
  try {
    fs.mkdirSync(".logs", { recursive: true });
    const cause = (err as { cause?: unknown })?.cause;
    fs.writeFileSync(
      file,
      `${err instanceof Error ? err.stack : String(err)}\n${cause ? `\ncaused by: ${cause instanceof Error ? cause.stack : String(cause)}\n` : ""}`,
    );
  } catch {
    return "(could not write trace file)";
  }
  return file;
}
