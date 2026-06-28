import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("auth frontend shell", () => {
  const html = readFileSync(join(process.cwd(), "..", "auth.html"), "utf8");

  it("uses unified localized API error messages for auth failures", () => {
    expect(html).toContain("function apiErrorMessage");
    expect(html).toContain("INVALID_CREDENTIALS");
    expect(html).toContain("EMAIL_ALREADY_EXISTS");
    expect(html).toContain("USER_BANNED");
    expect(html).toContain("error.code = data?.code");
  });
});
