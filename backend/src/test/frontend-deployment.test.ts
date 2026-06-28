import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("frontend deployment defaults", () => {
  const pages = ["auth.html", "index.html", "admin.html"];

  it.each(pages)("uses same-origin API by default outside local development: %s", (page) => {
    const html = readFileSync(join(process.cwd(), "..", page), "utf8");

    expect(html).toContain("const DEFAULT_API_BASE");
    expect(html).toContain("window.location.origin");
    expect(html).toContain('window.location.hostname === "127.0.0.1"');
    expect(html).toContain('window.location.hostname === "localhost"');
    expect(html).toContain('localStorage.getItem("apiBase") || DEFAULT_API_BASE');
    expect(html).not.toContain('localStorage.getItem("apiBase") || "http://127.0.0.1:4000"');
  });
});
