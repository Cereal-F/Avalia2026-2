/**
 * Cloudflare Pages Function — /api/auth/discord/callback
 * Valida o `state` (anti-CSRF), troca o authorization code pelo token do Discord,
 * obtém o perfil (@me) e grava um cookie de sessão HttpOnly assinado (HMAC) com
 * user_id, nome, avatar e expiração.
 */
import { assinarSessao, segredoSessao } from "../../../../src/sessao.js";

const SESSAO_MS = 24 * 60 * 60 * 1000;

const lerCookie = (request, nome) => {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + nome + "=([^;]+)"));
  return m ? m[1] : null;
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    return Response.redirect(new URL("/?auth_error=" + encodeURIComponent(error || "missing_code"), url.origin).href, 302);
  }

  const stateRecebido = url.searchParams.get("state");
  const stateEsperado = lerCookie(request, "oauth_state");
  if (!stateRecebido || !stateEsperado || stateRecebido !== stateEsperado) {
    return Response.redirect(new URL("/?auth_error=invalid_state", url.origin).href, 302);
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return Response.json({
      ok: false,
      error: "missing_credentials",
      message: "Defina DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET nas variáveis do Cloudflare Pages (Settings -> Environment variables).",
    }, { status: 500 });
  }

  const redirectUri = new URL("/api/auth/discord/callback", url.origin).href;

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      return Response.redirect(new URL("/?auth_error=token_exchange_failed", url.origin).href, 302);
    }

    const tokenData = await tokenRes.json();
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) {
      return Response.redirect(new URL("/?auth_error=fetch_user_failed", url.origin).href, 302);
    }

    const discordUser = await userRes.json();
    const userId = discordUser.id;
    const username = discordUser.global_name || discordUser.username;
    const avatar = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${userId}/${discordUser.avatar}.png`
      : "https://cdn.discordapp.com/embed/avatars/0.png";

    if (env.DB) {
      try {
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS discord_users (user_id TEXT PRIMARY KEY, username TEXT NOT NULL, avatar TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        ).run();
        await env.DB.prepare(
          "INSERT INTO discord_users (user_id, username, avatar, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, avatar = excluded.avatar, updated_at = CURRENT_TIMESTAMP"
        ).bind(userId, username, avatar).run();
      } catch {}
    }

    const token = await assinarSessao(
      { userId, username, avatar, exp: Date.now() + SESSAO_MS },
      segredoSessao(env)
    );

    const headers = new Headers({ Location: "/?login=success" });
    headers.append("Set-Cookie", `discord_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure`);
    headers.append("Set-Cookie", "oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure");
    return new Response(null, { status: 302, headers });
  } catch {
    return Response.redirect(new URL("/?auth_error=exception", url.origin).href, 302);
  }
}
