import { erro } from "../../src/batalha.js";

/** Placar geral: vitórias e derrotas acumuladas por jogador. */
export async function onRequestGet({ env }) {
  if (!env.DB) return erro("Banco D1 não vinculado ao projeto.", 503);
  const { results } = await env.DB.prepare(
    "SELECT user_id, username, avatar, vitorias, derrotas FROM placar ORDER BY vitorias DESC, derrotas ASC, username ASC LIMIT 20"
  ).all();
  return Response.json({ ok: true, placar: results });
}
