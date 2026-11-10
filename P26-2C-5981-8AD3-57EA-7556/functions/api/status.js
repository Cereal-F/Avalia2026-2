/** Health check da API e do banco D1. */
const CHAVE = "P26-2C-5981-8AD3-57EA-7556";

export async function onRequestGet({ env }) {
  let d1Connected = false;
  if (env.DB) {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      d1Connected = true;
    } catch {}
  }
  return Response.json({
    ok: true,
    chave: CHAVE,
    d1Connected,
    discordOAuthConfigured: Boolean(env.DISCORD_CLIENT_ID),
    serverTimestamp: new Date().toISOString(),
  });
}
