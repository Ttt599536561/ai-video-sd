import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production real provider mode", () => {
  const appSource = readFileSync(join(process.cwd(), "src", "app.ts"), "utf8");
  const serverSource = readFileSync(join(process.cwd(), "src", "server.ts"), "utf8");
  const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");

  it("does not require a second allow-real-posts switch once real video jobs are enabled", () => {
    expect(appSource).not.toContain("realVideoPostsAllowed");
    expect(serverSource).not.toContain("VIDEO_PROVIDER_ALLOW_REAL_POSTS");
    expect(envExample).not.toContain("VIDEO_PROVIDER_ALLOW_REAL_POSTS");
  });
});
