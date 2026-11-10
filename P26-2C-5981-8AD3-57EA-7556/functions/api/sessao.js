import { lerSessao, segredoSessao } from "../../src/sessao.js";

/** Informa ao front-end quem está logado (a identidade vem do cookie assinado). */
export async function onRequestGet({ request, env }) {
  const sessao = await lerSessao(request, segredoSessao(env));
  return Response.json({
    ok: true,
    configurado: Boolean(env.DISCORD_CLIENT_ID),
    logado: Boolean(sessao),
    usuario: sessao ? { userId: sessao.userId, username: sessao.username, avatar: sessao.avatar } : null,
  });
}
