import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Debian deployment artifacts", () => {
  const root = join(process.cwd(), "..");

  it("documents the production API layout and service paths", () => {
    const readme = readFileSync(join(root, "deploy", "debian", "README.md"), "utf8");
    const service = readFileSync(join(root, "deploy", "debian", "ai-video-api.service"), "utf8");
    const nginx = readFileSync(join(root, "deploy", "debian", "nginx-ai-video.conf"), "utf8");

    expect(readme).toContain("Debian 12.0 64bit");
    expect(readme).toContain("/etc/ai-video/backend.env");
    expect(readme).toContain("/var/lib/ai-video/storage/videos");
    expect(readme).toContain("npm run prisma:deploy");
    expect(readme).toContain("BOOTSTRAP_ADMIN_SECRET");
    expect(service).toContain("EnvironmentFile=/etc/ai-video/backend.env");
    expect(service).toContain("ExecStart=/usr/bin/node /opt/ai-video/backend/dist/server.js");
    expect(nginx).toContain("location /api/");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:4000");
  });

  it("keeps deployment templates secret-free", () => {
    const files = [
      join(root, "deploy", "debian", "backend.env.example"),
      join(root, "deploy", "debian", "README.md"),
      join(root, "deploy", "debian", "AI_DEPLOYMENT_PROMPT.md")
    ];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toContain("sk-");
      expect(content).not.toContain("admin-code-1782584735007@example.com");
      expect(content).not.toContain("password123");
      const providerKeyLine = content.match(/^VIDEO_PROVIDER_API_KEY="?([^"\n]+)"?$/im);
      if (providerKeyLine) {
        expect(providerKeyLine[1]).toMatch(/^REPLACE_/);
      }
    }
  });
});
