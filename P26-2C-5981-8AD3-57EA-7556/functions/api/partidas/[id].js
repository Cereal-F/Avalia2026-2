import { lerSessao, segredoSessao } from "../../../src/sessao.js";
import {
  erro,
  comBanco,
  FROTA,
  BOT_ID,
  validarFrota,
  classificarTiro,
  todosAfundados,
  validarCoordenada,
  chave,
  coordenadas,
  escolherAlvoBot,
} from "../../../src/batalha.js";

/** Papel do usuário na partida: 1 (criador), 2 (oponente) ou 0 (espectador/anônimo). */
const papelDe = (p, userId) => (!userId ? 0 : p.jogador1_id === userId ? 1 : p.jogador2_id === userId ? 2 : 0);

async function carregarPartida(DB, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return DB.prepare("SELECT * FROM partidas WHERE id = ?").bind(n).first();
}

const jogadorPublico = (p, n) => {
  const id = n === 1 ? p.jogador1_id : p.jogador2_id;
  if (!id) return null;
  return {
    id,
    nome: n === 1 ? p.jogador1_nome : p.jogador2_nome,
    avatar: n === 1 ? p.jogador1_avatar : p.jogador2_avatar,
  };
};

const paraCelulasPublicas = (json) =>
  JSON.parse(json).map((n) => ({ tamanho: n.tamanho, celulas: n.celulas.map((k) => coordenadas(k)) }));

/**
 * Estado da partida para o cliente. A frota do oponente NUNCA é enviada
 * (só após a partida ser finalizada); o jogador vê apenas o resultado dos próprios tiros.
 */
async function getHandler({ request, env, params }) {
  const p = await carregarPartida(env.DB, params.id);
  if (!p) return erro("Partida não encontrada.", 404);

  const sessao = await lerSessao(request, segredoSessao(env));
  const papel = papelDe(p, sessao?.userId);

  const { results: tabuleiros } = await env.DB.prepare(
    "SELECT jogador_id, navios_json, confirmado FROM tabuleiros WHERE partida_id = ?"
  ).bind(p.id).all();
  const { results: tiros } = await env.DB.prepare(
    "SELECT atirador_id, linha, coluna, resultado FROM tiros WHERE partida_id = ? ORDER BY id"
  ).bind(p.id).all();

  const idDo = (n) => (n === 1 ? p.jogador1_id : p.jogador2_id);
  const tabDe = (n) => tabuleiros.find((t) => t.jogador_id === idDo(n));
  const opn = papel === 1 ? 2 : 1;
  const meu = papel ? tabDe(papel) : null;
  const oponente = papel ? tabDe(opn) : null;
  const pub = (t) => ({ linha: t.linha, coluna: t.coluna, resultado: t.resultado });

  return Response.json({
    ok: true,
    partida: {
      id: p.id,
      status: p.status,
      vezDe: p.vez_de,
      vencedorId: p.vencedor_id,
      jogador1: jogadorPublico(p, 1),
      jogador2: jogadorPublico(p, 2),
    },
    papel: papel || null,
    frotaTamanhos: FROTA,
    euConfirmei: Boolean(meu?.confirmado),
    oponenteConfirmou: Boolean(oponente?.confirmado),
    meuTabuleiro: meu ? { navios: paraCelulasPublicas(meu.navios_json) } : null,
    tirosRecebidos: papel ? tiros.filter((t) => t.atirador_id === idDo(opn)).map(pub) : [],
    meusTiros: papel ? tiros.filter((t) => t.atirador_id === idDo(papel)).map(pub) : [],
    navioOponenteRevelado: p.status === "finalizada" && oponente ? paraCelulasPublicas(oponente.navios_json) : null,
  });
}

/** Ações da partida: entrar, posicionar, atirar. Toda regra é validada aqui, no servidor. */
async function postHandler({ request, env, params }) {
  const sessao = await lerSessao(request, segredoSessao(env));
  if (!sessao) return erro("Faça login com Discord OAuth2 para jogar.", 401);

  const p = await carregarPartida(env.DB, params.id);
  if (!p) return erro("Partida não encontrada.", 404);

  const corpo = await request.json().catch(() => null);
  if (!corpo) return erro("Corpo JSON inválido.", 400);

  if (corpo.acao === "entrar") return entrar(env.DB, p, sessao);

  const papel = papelDe(p, sessao.userId);
  if (!papel) return erro("Você não participa desta partida.", 403);

  if (corpo.acao === "posicionar") return posicionar(env.DB, p, sessao, corpo.navios);
  if (corpo.acao === "atirar") return atirar(env.DB, p, papel, sessao, corpo);
  return erro("Ação desconhecida.", 400);
}

async function entrar(DB, p, sessao) {
  if (p.status !== "aguardando") return erro("Esta partida não está aguardando oponente.", 409);
  if (p.jogador1_id === sessao.userId) return erro("Você não pode entrar na sua própria partida.", 409);
  const r = await DB.prepare(
    `UPDATE partidas SET jogador2_id = ?, jogador2_nome = ?, jogador2_avatar = ?, status = 'posicionando'
     WHERE id = ? AND status = 'aguardando' AND jogador2_id IS NULL`
  ).bind(sessao.userId, sessao.username, sessao.avatar || null, p.id).run();
  if (!r.meta.changes) return erro("Outro jogador entrou primeiro.", 409);
  return Response.json({ ok: true, status: "posicionando" });
}

async function posicionar(DB, p, sessao, navios) {
  if (p.status !== "posicionando") return erro("A fase de posicionamento não está ativa.", 409);
  const meu = await DB.prepare(
    "SELECT confirmado FROM tabuleiros WHERE partida_id = ? AND jogador_id = ?"
  ).bind(p.id, sessao.userId).first();
  if (meu?.confirmado) return erro("Sua frota já foi confirmada.", 409);

  const v = validarFrota(navios);
  if (!v.ok) return erro(v.erro, 422);

  const gravou = await DB.prepare(
    `INSERT INTO tabuleiros (partida_id, jogador_id, navios_json, confirmado) VALUES (?, ?, ?, 1)
     ON CONFLICT(partida_id, jogador_id) DO UPDATE SET navios_json = excluded.navios_json, confirmado = 1
     WHERE tabuleiros.confirmado = 0`
  ).bind(p.id, sessao.userId, JSON.stringify(v.navios)).run();
  if (!gravou.meta.changes) return erro("Sua frota já foi confirmada.", 409);

  const { total } = await DB.prepare(
    "SELECT COUNT(*) AS total FROM tabuleiros WHERE partida_id = ? AND confirmado = 1"
  ).bind(p.id).first();
  let iniciou = false;
  if (Number(total) === 2) {
    const r = await DB.prepare(
      "UPDATE partidas SET status = 'em_andamento', vez_de = jogador1_id WHERE id = ? AND status = 'posicionando'"
    ).bind(p.id).run();
    iniciou = r.meta.changes > 0;
  }
  return Response.json({ ok: true, iniciou });
}

async function atirar(DB, p, papel, sessao, { linha, coluna }) {
  if (p.status !== "em_andamento") return erro("A partida não está em andamento.", 409);
  if (p.vez_de !== sessao.userId) return erro("Não é a sua vez.", 409);
  if (!validarCoordenada(linha, coluna)) return erro("Coordenada inválida.", 422);

  const oponenteId = papel === 1 ? p.jogador2_id : p.jogador1_id;
  const { results: meus } = await DB.prepare(
    "SELECT linha, coluna FROM tiros WHERE partida_id = ? AND atirador_id = ?"
  ).bind(p.id, sessao.userId).all();
  const alvo = chave(linha, coluna);
  const jaTiradas = new Set(meus.map((t) => chave(t.linha, t.coluna)));
  if (jaTiradas.has(alvo)) return erro("Você já atirou nesta posição.", 409);

  const tab = await DB.prepare(
    "SELECT navios_json FROM tabuleiros WHERE partida_id = ? AND jogador_id = ?"
  ).bind(p.id, oponenteId).first();
  if (!tab) return erro("Frota do oponente indisponível.", 409);

  const navios = JSON.parse(tab.navios_json);
  const resultado = classificarTiro(navios, alvo, jaTiradas);
  jaTiradas.add(alvo);
  const venceu = todosAfundados(navios, jaTiradas);

  // Troca de vez condicional: impede que dois tiros concorrentes do mesmo jogador sejam aceitos.
  const troca = await DB.prepare(
    "UPDATE partidas SET vez_de = ? WHERE id = ? AND vez_de = ? AND status = 'em_andamento'"
  ).bind(venceu ? null : oponenteId, p.id, sessao.userId).run();
  if (!troca.meta.changes) return erro("Outra jogada foi registrada antes. Atualize a partida.", 409);

  await DB.prepare(
    "INSERT INTO tiros (partida_id, atirador_id, linha, coluna, resultado) VALUES (?, ?, ?, ?, ?)"
  ).bind(p.id, sessao.userId, linha, coluna, resultado).run();

  if (venceu) {
    await finalizarPartida(DB, p, sessao.userId);
    return Response.json({ ok: true, resultado, linha, coluna, venceu: true, jogadaBot: null });
  }

  // Partida contra o bot: o bot responde na mesma requisição. A frota do jogador nunca sai do servidor.
  const jogadaBot = p.jogador2_id === BOT_ID ? await jogarBot(DB, p) : null;
  return Response.json({ ok: true, resultado, linha, coluna, venceu: false, jogadaBot });
}

/** Jogada do bot: escolhe o alvo, aplica a regra e devolve o resultado (sem revelar a frota). */
async function jogarBot(DB, p) {
  const { results: tirosBot } = await DB.prepare(
    "SELECT linha, coluna, resultado FROM tiros WHERE partida_id = ? AND atirador_id = ?"
  ).bind(p.id, BOT_ID).all();
  const tab = await DB.prepare(
    "SELECT navios_json FROM tabuleiros WHERE partida_id = ? AND jogador_id = ?"
  ).bind(p.id, p.jogador1_id).first();
  if (!tab) return null;

  const navios = JSON.parse(tab.navios_json);
  const tiradas = new Set(tirosBot.map((t) => chave(t.linha, t.coluna)));
  const alvo = escolherAlvoBot(tiradas, tirosBot);
  const resultado = classificarTiro(navios, alvo, tiradas);
  tiradas.add(alvo);
  const venceu = todosAfundados(navios, tiradas);
  const { linha, coluna } = coordenadas(alvo);

  const troca = await DB.prepare(
    "UPDATE partidas SET vez_de = ? WHERE id = ? AND vez_de = ? AND status = 'em_andamento'"
  ).bind(venceu ? null : p.jogador1_id, p.id, BOT_ID).run();
  if (!troca.meta.changes) return null;

  await DB.prepare(
    "INSERT INTO tiros (partida_id, atirador_id, linha, coluna, resultado) VALUES (?, ?, ?, ?, ?)"
  ).bind(p.id, BOT_ID, linha, coluna, resultado).run();

  if (venceu) await finalizarPartida(DB, p, BOT_ID);
  return { linha, coluna, resultado };
}

/** Finaliza a partida e atualiza o placar apenas dos jogadores humanos. */
async function finalizarPartida(DB, p, vencedorId) {
  const fim = await DB.prepare(
    "UPDATE partidas SET status = 'finalizada', vencedor_id = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'em_andamento'"
  ).bind(vencedorId, p.id).run();
  if (!fim.meta.changes) return;

  const humanos = [
    { id: p.jogador1_id, nome: p.jogador1_nome, avatar: p.jogador1_avatar },
    { id: p.jogador2_id, nome: p.jogador2_nome, avatar: p.jogador2_avatar },
  ].filter((j) => j.id && j.id !== BOT_ID);
  for (const j of humanos) {
    await registrarPlacar(DB, j.id, j.nome, j.avatar, j.id === vencedorId ? "vitorias" : "derrotas");
  }
}

async function registrarPlacar(DB, userId, nome, avatar, campo) {
  const vit = campo === "vitorias" ? 1 : 0;
  const der = campo === "derrotas" ? 1 : 0;
  await DB.prepare(
    `INSERT INTO placar (user_id, username, avatar, vitorias, derrotas, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, avatar = excluded.avatar,
       vitorias = placar.vitorias + excluded.vitorias, derrotas = placar.derrotas + excluded.derrotas,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(userId, nome, avatar || null, vit, der).run();
}

export const onRequestGet = comBanco(getHandler);
export const onRequestPost = comBanco(postHandler);
