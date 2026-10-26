/**
 * Local-development account repository backed by a JSON file. This keeps
 * `npm start` dependency-free while exposing the same interface as the D1
 * repository used in production.
 *
 * Passwords are still PBKDF2-hashed; the file is only readable by the local
 * user (mode 0600) and should never be committed.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomId } from "../shared/crypto.js";

function clone(value) {
  return value ? structuredClone(value) : value;
}

export class FileAccountRepo {
  constructor(filePath) {
    this.filePath = filePath;
    this.users = new Map();
    this.sessions = new Map();
    this.progress = new Map();
    this.attempts = new Map();
    this.writeChain = Promise.resolve();
  }

  async load() {
    let raw;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return this;
      throw error;
    }

    try {
      const payload = JSON.parse(raw);
      for (const user of payload.users || []) this.users.set(user.id, user);
      for (const session of payload.sessions || []) this.sessions.set(session.tokenHash, session);
      for (const [userId, entry] of Object.entries(payload.progress || {})) {
        this.progress.set(userId, entry);
      }
      for (const [key, entry] of Object.entries(payload.attempts || {})) {
        this.attempts.set(key, entry);
      }
    } catch (error) {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      await rename(this.filePath, backup).catch(() => {});
      console.warn(`本地账号数据损坏，已备份到 ${backup}，将使用空数据启动。`, error.message);
    }
    return this;
  }

  async save() {
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      const payload = {
        version: 1,
        users: [...this.users.values()],
        sessions: [...this.sessions.values()],
        progress: Object.fromEntries(this.progress),
        attempts: Object.fromEntries(this.attempts),
      };
      await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(payload, null, 2), { mode: 0o600 });
      await rename(temp, this.filePath);
    });
    return this.writeChain;
  }

  async findUserByEmail(email) {
    const user = [...this.users.values()].find((item) => item.email === email);
    return clone(user) || null;
  }

  async findUserByExternalId(externalId) {
    const user = [...this.users.values()].find((item) => item.externalId === externalId);
    return clone(user) || null;
  }

  async findUserById(id) {
    return clone(this.users.get(id)) || null;
  }

  async createUser(user) {
    if (await this.findUserByEmail(user.email)) {
      throw new Error("UNIQUE constraint failed: users.email");
    }
    this.users.set(user.id, clone(user));
    await this.save();
    return clone(user);
  }

  async linkExternalUser(id, externalId, name, now) {
    const user = this.users.get(id);
    if (!user || user.externalId) return;
    user.externalId = externalId;
    user.name = name;
    user.updatedAt = now;
    await this.save();
  }

  async findOrCreateExternalUser({ externalId, email, name, now }) {
    let user = await this.findUserByExternalId(externalId);
    if (user) return user;

    user = await this.findUserByEmail(email);
    if (user) {
      if (!user.externalId) {
        await this.linkExternalUser(user.id, externalId, name, now);
        user = await this.findUserById(user.id);
      }
      return user;
    }

    const created = {
      id: randomId("usr"),
      email,
      name,
      passwordHash: null,
      externalId,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.createUser(created);
      return created;
    } catch {
      return (await this.findUserByExternalId(externalId)) || (await this.findUserByEmail(email));
    }
  }

  async createSession(session) {
    this.sessions.set(session.tokenHash, clone(session));
    await this.save();
    return clone(session);
  }

  async findSession(tokenHash, now) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= now) return null;
    return { userId: session.userId, expiresAt: session.expiresAt };
  }

  async deleteSession(tokenHash) {
    if (!this.sessions.delete(tokenHash)) return;
    await this.save();
  }

  async deleteExpiredSessions(now) {
    let changed = false;
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(key);
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  async getProgress(userId) {
    return clone(this.progress.get(userId)) || null;
  }

  async saveProgress(userId, data, baseRevision, now) {
    const current = this.progress.get(userId);

    if (!current) {
      if (baseRevision !== 0) {
        return { ok: false, revision: 0, updatedAt: 0, data: null };
      }
      const entry = { data, revision: 1, updatedAt: now };
      this.progress.set(userId, entry);
      await this.save();
      return { ok: true, revision: 1, updatedAt: now };
    }

    if (current.revision !== baseRevision) {
      return { ok: false, ...clone(current) };
    }

    const nextRevision = current.revision + 1;
    this.progress.set(userId, { data, revision: nextRevision, updatedAt: now });
    await this.save();
    return { ok: true, revision: nextRevision, updatedAt: now };
  }

  async getAttempt(key) {
    return clone(this.attempts.get(key)) || null;
  }

  async bumpAttempt(key, now, windowMs) {
    const current = this.attempts.get(key);
    const expired = !current || now - current.lastAt >= windowMs;
    const entry = {
      key,
      count: expired ? 1 : current.count + 1,
      firstAt: expired ? now : current.firstAt,
      lastAt: now,
    };
    this.attempts.set(key, entry);
    await this.save();
    return clone(entry);
  }

  async clearAttempt(key) {
    if (!this.attempts.delete(key)) return;
    await this.save();
  }
}

export async function createFileAccountRepo(filePath) {
  const repo = new FileAccountRepo(filePath);
  await repo.load();
  return repo;
}
