import { lerSessao, segredoSessao } from "../../../src/sessao.js";
import { erro } from "../../../src/batalha.js";

/** Lista partidas abertas e as partidas do próprio jogador. */
export async function onRequestGet({ request, env }) {
  if (!env.DB) return erro("Banco D1 não vinculado ao projeto.", 503);
  const sessao = await lerSessao(request, segredoSessao(env));
  const uid = sessao?.userId ?? "";
  const { results } = await env.DB.prepare(
    `SELECT id, status, jogador1_id, jogador1_nome, jogador2_id, jogador2_nome, vez_de, vencedor_id, created_at
     FROM partidas
     WHERE status = 'aguardando' OR jogador1_id = ? OR jogador2_id = ?
     ORDER BY id DESC LIMIT 30`
  ).bind(uid, uid).all();
  return Response.json({ ok: true, partidas: results });
}

/** Cria uma nova partida aguardando oponente. */
export async function onRequestPost({ request, env }) {
  if (!env.DB) return erro("Banco D1 não vinculado ao projeto.", 503);
  const sessao = await lerSessao(request, segredoSessao(env));
  if (!sessao) return erro("Faça login com Discord OAuth2 para criar partidas.", 401);

  const ativa = await env.DB.prepare(
    "SELECT id FROM partidas WHERE jogador1_id = ? AND status = 'aguardando' LIMIT 1"
  ).bind(sessao.userId).first();
  if (ativa) return erro("Você já tem uma partida aguardando oponente.", 409);

  const r = await env.DB.prepare(
    "INSERT INTO partidas (status, jogador1_id, jogador1_nome, jogador1_avatar) VALUES ('aguardando', ?, ?, ?)"
  ).bind(sessao.userId, sessao.username, sessao.avatar || null).run();
  return Response.json({ ok: true, id: r.meta.last_row_id }, { status: 201 });
}
