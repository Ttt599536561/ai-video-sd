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

  it.each(pages)("guards icon initialization when the icon CDN is unavailable: %s", (page) => {
    const html = readFileSync(join(process.cwd(), "..", page), "utf8");

    expect(html).toContain("function refreshIcons()");
    expect(html).toContain("window.lucide?.createIcons");
    expect(html).not.toMatch(/(?<!window\.)lucide\.createIcons\(\);/);
    expect(html).not.toContain("window.refreshIcons();");
  });

  it.each(pages)("declares the bundled SVG favicon: %s", (page) => {
    const html = readFileSync(join(process.cwd(), "..", page), "utf8");

    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');

    const favicon = readFileSync(join(process.cwd(), "..", "favicon.svg"), "utf8");
    expect(favicon).toContain("<svg");
    expect(favicon).toContain('viewBox="0 0 64 64"');
  });

  it.each(pages)("keeps frontend HTML files free of UTF-8 BOM bytes: %s", (page) => {
    const bytes = readFileSync(join(process.cwd(), "..", page));

    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  });
});
