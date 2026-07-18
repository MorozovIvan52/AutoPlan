import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import {
  createSession,
  destroySession,
  safeUser,
  getAuthUser,
  rotateSession,
  revokeUserSessions,
  revokeOtherSessions,
} from "../lib/session";
import { requireAuth } from "../middleware/auth";
import { hashPassword, validatePasswordStrength, verifyPassword, passwordPolicy } from "../lib/password";
import { hasUsers, runInitialSetup } from "../lib/setup";
import { isProduction, isSecureCookies } from "../lib/env";
import {
  trackLoginSession,
  trackLogoutSession,
} from "../lib/activity-track";
import {
  checkLoginRateLimit,
  checkSetupRateLimit,
  clientIp,
  timingSafeEqualText,
  resetLoginRateLimit,
} from "../middleware/security";
import { ensureDemoAccountAndData, isDemoEnabled } from "../lib/demo-seed";
import { offerRequiredForUser, tenantOfferAccepted } from "../lib/license-offer";
import { DEFAULT_TENANT_ID } from "../lib/tenant-bootstrap";
import { jsonApiError } from "../lib/api-error";

async function userWithOffer(user: typeof schema.users.$inferSelect) {
  const tenantId = user.tenantId ?? DEFAULT_TENANT_ID;
  const required = offerRequiredForUser(user);
  const accepted = required ? await tenantOfferAccepted(tenantId) : true;
  return { ...safeUser(user), offerAccepted: accepted, offerRequired: required };
}
function sessionCookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "Lax" as const,
    maxAge: 60 * 60 * 24 * 7,
    secure: isSecureCookies(),
  };
}

export const auth = new Hono()
  .get("/setup-status", async (c) => {
    return c.json({ needsSetup: !(await hasUsers()) }, 200);
  })
  .get("/password-policy", (c) => c.json(passwordPolicy(), 200))
  .post("/setup", async (c) => {
    const ip = clientIp(c);
    const setupLimit = checkSetupRateLimit(ip);
    if (!setupLimit.ok) {
      return c.json({ error: `Слишком много попыток. Повторите через ${setupLimit.retryAfterSec} сек.` }, 429);
    }
    if (await hasUsers()) return c.json({ error: "Система уже настроена" }, 400);

    const body = await c.req.json<{ email?: string; password?: string; name?: string; installKey?: string }>();
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    if (!email || !email.includes("@")) return c.json({ error: "Укажите корректный email" }, 400);
    const pwErr = validatePasswordStrength(password, email);
    if (pwErr) return c.json({ error: pwErr }, 400);

    const installKey = process.env.INSTALL_SECRET?.trim();
    if (isProduction()) {
      if (!installKey) {
        return c.json({ error: "Установка через UI отключена. Задайте INSTALL_SECRET на сервере." }, 403);
      }
      const provided = c.req.header("x-install-key") || body.installKey || "";
      if (!provided || !timingSafeEqualText(provided, installKey)) {
        return c.json({ error: "Неверный ключ установки" }, 403);
      }
    } else if (installKey) {
      const provided = c.req.header("x-install-key") || body.installKey || "";
      if (!provided || !timingSafeEqualText(provided, installKey)) {
        return c.json({ error: "Неверный ключ установки" }, 403);
      }
    }

    try {
      const user = await runInitialSetup({ email, password, name: body.name });
      const sessionId = await createSession(user.id);
      setCookie(c, "session", sessionId, sessionCookieOptions());
      void trackLoginSession({
        userId: user.id,
        sessionId,
        ip: clientIp(c),
        userAgent: c.req.header("user-agent"),
      });
      return c.json({ ok: true, user: safeUser(user) }, 201);
    } catch (e: unknown) {
      return jsonApiError(c, e, "Ошибка установки", 500, "auth_setup");
    }
  })
  .post("/login", async (c) => {
    const ip = clientIp(c);
    const { email, password } = await c.req.json<{ email: string; password: string }>();
    const normalizedEmail = email.trim().toLowerCase();
    const limit = checkLoginRateLimit(ip, normalizedEmail);
    if (!limit.ok) {
      return c.json({ error: `Слишком много попыток. Повторите через ${limit.retryAfterSec} сек.` }, 429);
    }

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, normalizedEmail));
    const verified = user ? await verifyPassword(password, user.passwordHash) : { ok: false, needsRehash: false };
    if (!user || !verified.ok) {
      return c.json({ error: "Неверный email или пароль" }, 401);
    }
    if (user.isActive === false) {
      return c.json({ error: "Учётная запись отключена" }, 403);
    }
    if (verified.needsRehash) {
      await db.update(schema.users)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(schema.users.id, user.id));
    }

    const oldSid = getCookie(c, "session");
    const sessionId = await rotateSession(oldSid, user.id);
    setCookie(c, "session", sessionId, sessionCookieOptions());
    resetLoginRateLimit(ip, normalizedEmail);
    void trackLoginSession({
      userId: user.id,
      sessionId,
      ip: clientIp(c),
      userAgent: c.req.header("user-agent"),
    });
    return c.json({ user: await userWithOffer(user) }, 200);
  })
  .post("/demo-login", async (c) => {
    if (!isDemoEnabled()) {
      return c.json({ error: "Демо-доступ отключён" }, 403);
    }
    const ip = clientIp(c);
    const limit = checkLoginRateLimit(ip);
    if (!limit.ok) {
      return c.json({ error: `Слишком много попыток. Повторите через ${limit.retryAfterSec} сек.` }, 429);
    }

    const { userId } = await ensureDemoAccountAndData();
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) return c.json({ error: "Не удалось создать демо-аккаунт" }, 500);

    const oldSid = getCookie(c, "session");
    const sessionId = await rotateSession(oldSid, user.id);
    setCookie(c, "session", sessionId, sessionCookieOptions());
    void trackLoginSession({
      userId: user.id,
      sessionId,
      ip: clientIp(c),
      userAgent: c.req.header("user-agent"),
    });
    return c.json({ user: await userWithOffer(user), demo: true }, 200);
  })
  .post("/logout", async (c) => {
    const sid = getCookie(c, "session");
    if (sid) {
      await trackLogoutSession(sid);
      await destroySession(sid);
    }
    deleteCookie(c, "session", { path: "/" });
    return c.json({ ok: true }, 200);
  })
  .post("/logout-all", requireAuth, async (c) => {
    const userId = c.get("userId") as number;
    await revokeUserSessions(userId);
    deleteCookie(c, "session", { path: "/" });
    return c.json({ ok: true }, 200);
  })
  .post("/logout-others", requireAuth, async (c) => {
    const userId = c.get("userId") as number;
    const sid = getCookie(c, "session");
    if (sid) await revokeOtherSessions(userId, sid);
    return c.json({ ok: true }, 200);
  })
  .post("/change-password", requireAuth, async (c) => {
    const userId = c.get("userId") as number;
    const body = await c.req.json<{ currentPassword?: string; newPassword?: string }>();
    const currentPassword = body.currentPassword || "";
    const newPassword = body.newPassword || "";

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const verified = await verifyPassword(currentPassword, user.passwordHash);
    if (!verified.ok) return c.json({ error: "Неверный текущий пароль" }, 401);

    const pwErr = validatePasswordStrength(newPassword, user.email);
    if (pwErr) return c.json({ error: pwErr }, 400);

    await db.update(schema.users)
      .set({ passwordHash: await hashPassword(newPassword) })
      .where(eq(schema.users.id, userId));

    const sid = getCookie(c, "session");
    if (sid) await revokeOtherSessions(userId, sid);
    const newSid = sid ? await rotateSession(sid, userId) : await createSession(userId);
    setCookie(c, "session", newSid, sessionCookieOptions());
    return c.json({ ok: true }, 200);
  })
  .get("/me", async (c) => {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ user: await userWithOffer(user) }, 200);
  })
  .patch("/theme", requireAuth, async (c) => {
    const userId = c.get("userId") as number;
    const { theme } = await c.req.json<{ theme: string }>();
    const [user] = await db.update(schema.users).set({ theme }).where(eq(schema.users.id, userId)).returning();
    return c.json({ user: safeUser(user) }, 200);
  })

  .patch("/nav-prefs", requireAuth, async (c) => {
    const userId = c.get("userId") as number;
    const body = await c.req.json<{ hidden?: unknown; order?: unknown }>();
    const [current] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!current) return c.json({ error: "Не найден" }, 404);

    const locked = new Set(["/", "/settings"]);
    const patch: { navHidden?: string; navOrder?: string } = {};

    if ("hidden" in body) {
      const hidden = Array.isArray(body.hidden)
        ? body.hidden.filter((p): p is string => typeof p === "string" && p.length > 0 && !locked.has(p))
        : [];
      patch.navHidden = JSON.stringify(hidden);
    }

    if ("order" in body) {
      const order = Array.isArray(body.order)
        ? body.order.filter((p): p is string => typeof p === "string" && p.startsWith("/") && p.length < 80)
        : [];
      const seen = new Set<string>();
      const uniq = order.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
      patch.navOrder = JSON.stringify(uniq);
    }

    if (!Object.keys(patch).length) {
      return c.json({ user: safeUser(current) }, 200);
    }

    const [user] = await db.update(schema.users)
      .set(patch)
      .where(eq(schema.users.id, userId))
      .returning();
    return c.json({ user: safeUser(user) }, 200);
  });
