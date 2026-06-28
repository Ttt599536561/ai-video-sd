import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../repositories/memory-store.js";
import { AuthService } from "../services/auth.service.js";

describe("AuthService", () => {
  it("registers an email user with a hashed password and logs in", async () => {
    const store = new InMemoryStore();
    const auth = new AuthService(store, { jwtSecret: "test-secret" });

    const created = await auth.register({ email: "person@example.com", password: "password123" });
    expect(created.user.email).toBe("person@example.com");
    expect(store.users[0].passwordHash).not.toBe("password123");

    const login = await auth.login({ email: "person@example.com", password: "password123" });
    expect(login.user.id).toBe(created.user.id);
    expect(login.token).toContain(".");
  });

  it("rejects duplicate emails and wrong passwords", async () => {
    const store = new InMemoryStore();
    const auth = new AuthService(store, { jwtSecret: "test-secret" });

    await auth.register({ email: "person@example.com", password: "password123" });
    await expect(auth.register({ email: "person@example.com", password: "password123" })).rejects.toThrow(
      "Email already exists"
    );
    await expect(auth.login({ email: "person@example.com", password: "wrong-password" })).rejects.toThrow(
      "Invalid email or password"
    );
  });

  it("changes a user password only when the current password is correct", async () => {
    const store = new InMemoryStore();
    const auth = new AuthService(store, { jwtSecret: "test-secret" });

    const created = await auth.register({ email: "person@example.com", password: "password123" });

    await expect(
      auth.changePassword({
        userId: created.user.id,
        currentPassword: "wrong-password",
        newPassword: "new-password123"
      })
    ).rejects.toThrow("Invalid current password");

    await auth.changePassword({
      userId: created.user.id,
      currentPassword: "password123",
      newPassword: "new-password123"
    });

    await expect(auth.login({ email: "person@example.com", password: "password123" })).rejects.toThrow(
      "Invalid email or password"
    );
    const login = await auth.login({ email: "person@example.com", password: "new-password123" });
    expect(login.user.id).toBe(created.user.id);
  });
});
