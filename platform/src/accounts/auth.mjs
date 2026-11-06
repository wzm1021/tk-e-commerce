import { z } from "zod";
import {
  token,
  hash,
  verifyPassword,
  requireThat,
  AppError,
  uuid,
} from "../common/core.mjs";
const Login = z
  .object({
    login: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(256),
    audience: z.enum(["web", "admin"]).default("web"),
  })
  .strict();
export function installAuth(app, db, config) {
  const cookieName = (a) =>
    a === "admin" ? "tidelab_admin" : "tidelab_session";
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: config.cookieSecure,
    maxAge: 12 * 60 * 60,
  };
  app.decorateRequest("identity", null);
  app.decorateRequest("workspace", null);
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "5 minutes" } } },
    async (req, reply) => {
      const v = Login.parse(req.body);
      requireThat(
        !(
          req.publicIngress &&
          v.audience === "admin" &&
          !config.publicAdminEnabled
        ),
        "not_found",
        404,
      );
      const u = (
        await db.query(
          "SELECT * FROM users WHERE enabled AND (email=$2 OR login=$1) ORDER BY (email=$2) DESC NULLS LAST LIMIT 1",
          [v.login, v.login.toLowerCase()],
        )
      ).rows[0];
      const dummy =
        "scrypt:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";
      requireThat(
        (await verifyPassword(v.password, u?.password_hash || dummy)) &&
          u &&
          (v.audience === "web" || u.is_admin),
        "login_failed",
        401,
      );
      const session = token(),
        csrf = token();
      await db.query(
        "INSERT INTO sessions(token_hash,user_id,audience,csrf_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '12 hours')",
        [hash(session), u.id, v.audience, hash(csrf)],
      );
      reply.setCookie(cookieName(v.audience), session, cookieOptions);
      reply.setCookie(cookieName(v.audience) + "_csrf", csrf, {
        ...cookieOptions,
        httpOnly: false,
      });
      return { ok: true };
    },
  );
  async function identity(req, audience) {
    requireThat(
      !(
        req.publicIngress &&
        audience === "admin" &&
        !config.publicAdminEnabled
      ),
      "not_found",
      404,
    );
    const raw = req.cookies[cookieName(audience)];
    requireThat(raw, "authentication_required", 401);
    const row = (
      await db.query(
        "SELECT u.id,u.login,u.email,u.email_verified_at,u.display_name,u.is_admin,s.csrf_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.audience=$2 AND s.expires_at>now() AND u.enabled",
        [hash(raw), audience],
      )
    ).rows[0];
    requireThat(
      row && (audience !== "admin" || row.is_admin),
      "authentication_required",
      401,
    );
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
      requireThat(
        hash(req.headers["x-csrf-token"] || "") === row.csrf_hash,
        "csrf_invalid",
        403,
      );
    req.identity = {
      id: row.id,
      login: row.login,
      display_name: row.display_name,
      is_admin: row.is_admin,
      email: row.email,
      email_verified_at: row.email_verified_at,
    };
    return req.identity;
  }
  app.decorate("admin", async (req) => identity(req, "admin"));
  app.decorate("account", async (req) => identity(req, "web"));
  app.decorate("user", async (req) => {
    await identity(req, "web");
    const workspaceId = uuid.parse(
      req.headers["x-workspace-id"] || req.query.workspace,
    );
    requireThat(
      (
        await db.query(
          "SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND m.workspace_id=$2 AND w.enabled",
          [req.identity.id, workspaceId],
        )
      ).rowCount,
      "workspace_forbidden",
      403,
    );
    req.workspace = workspaceId;
  });
  app.get("/api/auth/me", async (req) => {
    const audience = req.query.audience === "admin" ? "admin" : "web";
    const u = await identity(req, audience);
    const ws = await db.query(
      "SELECT w.id,w.name,w.kind,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND w.enabled ORDER BY w.created_at",
      [u.id],
    );
    return { user: u, workspaces: ws.rows };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const audience = req.body?.audience === "admin" ? "admin" : "web";
    await identity(req, audience);
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(req.cookies[cookieName(audience)]),
    ]);
    reply.clearCookie(cookieName(audience), { path: "/" });
    reply.clearCookie(cookieName(audience) + "_csrf", { path: "/" });
    return { ok: true };
  });
}
