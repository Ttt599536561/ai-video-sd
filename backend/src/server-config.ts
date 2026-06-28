type EnvLike = Record<string, string | undefined>;

export interface ModelConfigEncryptionKeyring {
  currentVersion: number;
  currentKey: Buffer;
  keyForVersion(version?: number): Buffer;
}

export function requiredEnv(env: EnvLike, name: string, fallback?: string): string {
  const value = env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function shouldUseMemoryStore(env: EnvLike): boolean {
  if (env.USE_IN_MEMORY_STORE === "true") return true;
  if (env.DATABASE_URL) return false;
  if (env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production unless USE_IN_MEMORY_STORE=true");
  }
  return true;
}

export function parseModelConfigEncryptionKey(env: EnvLike): Buffer {
  if (env.MODEL_CONFIG_ENCRYPTION_KEY_BASE64) {
    return parseEncodedKey("MODEL_CONFIG_ENCRYPTION_KEY_BASE64", env.MODEL_CONFIG_ENCRYPTION_KEY_BASE64, "base64");
  }
  if (env.MODEL_CONFIG_ENCRYPTION_KEY_HEX) {
    return parseEncodedKey("MODEL_CONFIG_ENCRYPTION_KEY_HEX", env.MODEL_CONFIG_ENCRYPTION_KEY_HEX, "hex");
  }
  throw new Error("MODEL_CONFIG_ENCRYPTION_KEY_BASE64 is required");
}

export function parseModelConfigEncryptionKeyring(env: EnvLike): ModelConfigEncryptionKeyring {
  if (!env.MODEL_CONFIG_ENCRYPTION_KEYS) {
    return createModelConfigEncryptionKeyring(new Map([[1, parseModelConfigEncryptionKey(env)]]), 1);
  }

  const keys = new Map<number, Buffer>();
  for (const rawEntry of env.MODEL_CONFIG_ENCRYPTION_KEYS.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const [versionText, encoding, value] = entry.split(":");
    const version = Number(versionText);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("MODEL_CONFIG_ENCRYPTION_KEYS versions must be positive integers");
    }
    if (keys.has(version)) {
      throw new Error(`MODEL_CONFIG_ENCRYPTION_KEYS contains duplicate version ${version}`);
    }
    if (encoding !== "base64" && encoding !== "hex") {
      throw new Error("MODEL_CONFIG_ENCRYPTION_KEYS entries must use base64 or hex encoding");
    }
    if (!value) {
      throw new Error("MODEL_CONFIG_ENCRYPTION_KEYS entries must include an encoded key");
    }
    keys.set(version, parseEncodedKey(`MODEL_CONFIG_ENCRYPTION_KEYS version ${version}`, value, encoding));
  }

  const currentVersion = Number(env.MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION);
  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new Error("MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION must be a positive integer");
  }
  return createModelConfigEncryptionKeyring(keys, currentVersion);
}

function parseEncodedKey(name: string, value: string, encoding: BufferEncoding): Buffer {
  const key = Buffer.from(value, encoding);
  if (key.length !== 32) {
    throw new Error(`${name} must decode to 32 bytes`);
  }
  return key;
}

export function createModelConfigEncryptionKeyring(
  keys: Map<number, Buffer>,
  currentVersion: number
): ModelConfigEncryptionKeyring {
  const currentKey = keys.get(currentVersion);
  if (!currentKey) {
    throw new Error(`MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION ${currentVersion} is not configured`);
  }

  return {
    currentVersion,
    currentKey,
    keyForVersion(version = 1) {
      const key = keys.get(version);
      if (!key) {
        throw new Error(`Model config encryption key version ${version} is not configured`);
      }
      return key;
    }
  };
}
