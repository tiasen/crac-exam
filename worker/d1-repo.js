/**
 * Cloudflare D1 repository used by the Worker. All values are bound
 * parameters; no SQL is built from user input.
 */

import { randomId } from "../shared/crypto.js";

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash || null,
    externalId: row.external_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createD1Repo(db) {
  return {
    async findUserByEmail(email) {
      const row = await db
        .prepare("SELECT * FROM users WHERE email = ?")
        .bind(email)
        .first();
      return mapUser(row);
    },

    async findUserByExternalId(externalId) {
      const row = await db
        .prepare("SELECT * FROM users WHERE external_id = ?")
        .bind(externalId)
        .first();
      return mapUser(row);
    },

    async findUserById(id) {
      const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
      return mapUser(row);
    },

    async createUser(user) {
      await db
        .prepare(
          `INSERT INTO users (id, email, name, password_hash, external_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          user.id,
          user.email,
          user.name,
          user.passwordHash || null,
          user.externalId || null,
          user.createdAt,
          user.updatedAt,
        )
        .run();
      return user;
    },

    async linkExternalUser(id, externalId, name, now) {
      await db
        .prepare(
          `UPDATE users
           SET external_id = ?, name = ?, updated_at = ?
           WHERE id = ? AND external_id IS NULL`,
        )
        .bind(externalId, name, now, id)
        .run();
    },

    async findOrCreateExternalUser({ externalId, email, name, now }) {
      let user = await this.findUserByExternalId(externalId);
      if (user) return user;

      user = await this.findUserByEmail(email);
      if (user) {
        if (!user.externalId) {
          await this.linkExternalUser(user.id, externalId, name, now);
          user = { ...user, externalId, name, updatedAt: now };
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
      } catch (error) {
        const raced =
          (await this.findUserByExternalId(externalId)) ||
          (await this.findUserByEmail(email));
        if (raced) return raced;
        throw error;
      }
    },

    async createSession(session) {
      await db
        .prepare(
          `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(session.tokenHash, session.userId, session.createdAt, session.expiresAt)
        .run();
      return session;
    },

    async findSession(tokenHash, now) {
      const row = await db
        .prepare(
          `SELECT user_id, expires_at FROM sessions
           WHERE token_hash = ? AND expires_at > ?`,
        )
        .bind(tokenHash, now)
        .first();
      return row ? { userId: row.user_id, expiresAt: row.expires_at } : null;
    },

    async deleteSession(tokenHash) {
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    },

    async deleteExpiredSessions(now) {
      await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
    },

    async getProgress(userId) {
      const row = await db
        .prepare("SELECT data, revision, updated_at FROM progress WHERE user_id = ?")
        .bind(userId)
        .first();
      if (!row) return null;
      return {
        data: row.data,
        revision: row.revision,
        updatedAt: row.updated_at,
      };
    },

    async saveProgress(userId, data, baseRevision, now) {
      const current = await this.getProgress(userId);

      if (!current) {
        if (baseRevision !== 0) {
          return { ok: false, revision: 0, updatedAt: 0, data: null };
        }
        try {
          await db
            .prepare(
              `INSERT INTO progress (user_id, data, revision, updated_at)
               VALUES (?, ?, 1, ?)`,
            )
            .bind(userId, data, now)
            .run();
          return { ok: true, revision: 1, updatedAt: now };
        } catch (error) {
          const latest = await this.getProgress(userId);
          if (latest) return { ok: false, ...latest };
          throw error;
        }
      }

      if (current.revision !== baseRevision) {
        return { ok: false, ...current };
      }

      const nextRevision = current.revision + 1;
      const result = await db
        .prepare(
          `UPDATE progress
           SET data = ?, revision = ?, updated_at = ?
           WHERE user_id = ? AND revision = ?`,
        )
        .bind(data, nextRevision, now, userId, current.revision)
        .run();

      if (result.meta?.changes) {
        return { ok: true, revision: nextRevision, updatedAt: now };
      }

      const latest = await this.getProgress(userId);
      return { ok: false, ...(latest || current) };
    },

    async getAttempt(key) {
      const row = await db
        .prepare(
          "SELECT attempt_key, count, first_at, last_at FROM auth_attempts WHERE attempt_key = ?",
        )
        .bind(key)
        .first();
      if (!row) return null;
      return { key: row.attempt_key, count: row.count, firstAt: row.first_at, lastAt: row.last_at };
    },

    async bumpAttempt(key, now, windowMs) {
      const current = await this.getAttempt(key);
      const expired = !current || now - current.lastAt >= windowMs;
      const count = expired ? 1 : current.count + 1;
      const firstAt = expired ? now : current.firstAt;
      await db
        .prepare(
          `INSERT INTO auth_attempts (attempt_key, count, first_at, last_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(attempt_key) DO UPDATE SET
             count = excluded.count,
             first_at = excluded.first_at,
             last_at = excluded.last_at`,
        )
        .bind(key, count, firstAt, now)
        .run();
      return { key, count, firstAt, lastAt: now };
    },

    async clearAttempt(key) {
      await db.prepare("DELETE FROM auth_attempts WHERE attempt_key = ?").bind(key).run();
    },
  };
}
