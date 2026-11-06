import { mkdir, open, readFile, link, unlink, statfs } from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { hash, id, uuid, requireThat, AppError } from "../common/core.mjs";
export class LocalStore {
  constructor(root) {
    this.root = path.resolve(root);
  }
  location(key) {
    requireThat(/^[a-z0-9-]+\/[a-f0-9]{64}$/.test(key), "invalid_object_key");
    return path.join(this.root, "objects", key);
  }
  async put(workspaceId, bytes) {
    requireThat(uuid.safeParse(workspaceId).success, "invalid_workspace");
    requireThat(bytes.length <= 12 * 1024 * 1024, "file_too_large", 413);
    await mkdir(path.join(this.root, "objects", workspaceId), {
      recursive: true,
      mode: 0o700,
    });
    const space = await statfs(this.root);
    requireThat(
      Number(space.bavail) * Number(space.bsize) > 5 * 1024 ** 3,
      "disk_capacity",
      503,
    );
    const sha = hash(bytes),
      key = `${workspaceId}/${sha}`,
      dest = this.location(key),
      tmp = dest + "." + id() + ".tmp";
    const f = await open(tmp, "wx", 0o600);
    try {
      await f.writeFile(bytes);
      await f.sync();
    } finally {
      await f.close();
    }
    try {
      await link(tmp, dest);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    } finally {
      await unlink(tmp);
    }
    const dir = await open(path.dirname(dest), "r");
    await dir.sync();
    await dir.close();
    return { object_key: key, sha256: sha, size_bytes: bytes.length };
  }
  async read(key, sha) {
    const bytes = await readFile(this.location(key));
    if (hash(bytes) !== sha) throw new AppError("artifact_integrity", 503);
    return bytes;
  }
}
export class SecretStore {
  constructor(root, key) {
    requireThat(
      Buffer.isBuffer(key) && key.length === 32,
      "master_key_invalid",
      500,
    );
    this.root = path.resolve(root, "secrets");
    this.key = key;
  }
  async write(secret, context) {
    requireThat(
      typeof secret === "string" &&
        secret.length >= 1 &&
        secret.length <= 16000,
      "invalid_secret",
    );
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const ref = id(),
      iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    const data = {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    const destination = path.join(this.root, ref);
    const temporary = destination + ".tmp";
    const f = await open(temporary, "wx", 0o600);
    try {
      await f.writeFile(JSON.stringify(data));
      await f.sync();
    } finally {
      await f.close();
    }
    try {
      await link(temporary, destination);
    } finally {
      await unlink(temporary);
    }
    const directory = await open(this.root, "r");
    await directory.sync();
    await directory.close();
    return ref;
  }
  async read(ref, context) {
    requireThat(uuid.safeParse(ref).success, "invalid_secret_ref");
    const data = JSON.parse(await readFile(path.join(this.root, ref), "utf8"));
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(data.iv, "base64"),
    );
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(data.tag, "base64"));
    return Buffer.concat([
      cipher.update(Buffer.from(data.ciphertext, "base64")),
      cipher.final(),
    ]).toString("utf8");
  }
}
