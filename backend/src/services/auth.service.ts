import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { PublicUser, UserRole } from "../domain/types.js";
import { toPublicUser } from "../domain/types.js";
import type { InMemoryStore } from "../repositories/memory-store.js";
import { createId } from "./crypto.service.js";

interface AuthOptions {
  jwtSecret: string;
}

interface RegisterInput {
  email: string;
  password: string;
  role?: UserRole;
}

interface LoginInput {
  email: string;
  password: string;
}

interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export class AuthService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly options: AuthOptions
  ) {}

  async register(input: RegisterInput): Promise<{ user: PublicUser; token: string }> {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) {
      throw new Error("Invalid email");
    }
    if (input.password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    if (this.store.findUserByEmail(email)) {
      throw new Error("Email already exists");
    }

    const now = new Date();
    const user = {
      id: createId(),
      email,
      passwordHash: await bcrypt.hash(input.password, 10),
      role: input.role ?? "USER",
      status: "ACTIVE" as const,
      creditBalance: 0,
      createdAt: now,
      updatedAt: now
    };
    this.store.users.push(user);

    return {
      user: toPublicUser(user),
      token: this.signToken(user.id, user.role)
    };
  }

  async login(input: LoginInput): Promise<{ user: PublicUser; token: string }> {
    const user = this.store.findUserByEmail(input.email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new Error("Invalid email or password");
    }
    if (user.status === "BANNED") {
      throw new Error("User is banned");
    }

    return {
      user: toPublicUser(user),
      token: this.signToken(user.id, user.role)
    };
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    const user = this.store.findUserById(input.userId);
    if (!user) {
      throw new Error("User not found");
    }
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      throw new Error("Invalid current password");
    }
    if (input.newPassword.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    user.passwordHash = await bcrypt.hash(input.newPassword, 10);
    user.updatedAt = new Date();
  }

  verifyToken(token: string): { userId: string; role: UserRole } {
    const payload = jwt.verify(token, this.options.jwtSecret) as { sub: string; role: UserRole };
    return { userId: payload.sub, role: payload.role };
  }

  private signToken(userId: string, role: UserRole): string {
    return jwt.sign({ role }, this.options.jwtSecret, {
      subject: userId,
      expiresIn: "7d"
    });
  }
}
