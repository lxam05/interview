import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@/research/errors";

describe("docs/errors.md", () => {
  it("has a heading for every error code", () => {
    const doc = fs.readFileSync(path.join(process.cwd(), "docs/errors.md"), "utf8");
    const headings = new Set([...doc.matchAll(/^## ([A-Z_]+)$/gm)].map((m) => m[1]));
    const missing = Object.keys(ERROR_CODES).filter((c) => !headings.has(c));
    expect(missing).toEqual([]);
  });
});
