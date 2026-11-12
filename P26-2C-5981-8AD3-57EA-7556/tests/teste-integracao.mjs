// Testes de integração dos handlers da API (Batalha Naval Tático) com D1 falso em memória.
// Importa os arquivos reais do projeto (somente leitura). Nada é gravado no projeto.
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";

const PROJ = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const u = (rel) => pathToFileURL(`${PROJ}/${rel}`).href;

const { assinarSessao } = await import(u("src/sessao.js"));
const { BOT_ID } = await import(u("src/batalha.js"));
const assinarSessaoTeste = (dados, segredo) => assinarSessao({ exp: Date.now() + 3600000, ...dados }, segredo);
const colecao = await import(u("functions/api/partidas/index.js"));
const partida = await import(u("functions/api/partidas/[id].js"));
const placarApi = await import(u("functions/api/placar.js"));

const SEGREDO = "segredo-de-teste-agente3";
const P1 = { userId: "111", username: "Jogador1", avatar: "av1" };
const P2 = { userId: "222", username: "Jogador2", avatar: null };
const clone = (x) => structuredClone(x);

/* ---------- D1 falso: implementa somente o SQL usado pelos handlers ---------- */
function criarD1() {
  const t = { partidas: [], tabuleiros: [], tiros: [], placar: [] };
  let seqPartida = 0;
  let seqTiro = 0;
  const unico = (tab) => {
    throw new Error(`UNIQUE constraint failed: ${tab}`);
  };
  const semMudanca = { rows: [], meta: { changes: 0 } };

  function exec(s, p) {
    if (s.startsWith("CREATE ")) return { rows: [], meta: { changes: 0, last_row_id: 0 } };

    // ----- partidas -----
    if (s.startsWith("SELECT id, status, jogador1_id")) {
      const rows = t.partidas
        .filter((r) => r.status === "aguardando" || r.jogador1_id === p[0] || r.jogador2_id === p[1])
        .sort((a, b) => b.id - a.id)
        .slice(0, 30);
      return { rows: clone(rows), meta: {} };
    }
    if (s.startsWith("SELECT * FROM partidas WHERE id = ?")) {
      return { rows: clone(t.partidas.filter((r) => r.id === p[0])), meta: {} };
    }
    if (s.startsWith("SELECT id FROM partidas WHERE jogador1_id = ? AND status = 'aguardando'")) {
      const rows = t.partidas
        .filter((r) => r.jogador1_id === p[0] && r.status === "aguardando")
        .map((r) => ({ id: r.id }));
      return { rows, meta: {} };
    }
    if (s.startsWith("INSERT INTO partidas") && s.includes("VALUES ('posicionando'")) {
      const id = ++seqPartida;
      t.partidas.push({
        id, status: "posicionando", jogador1_id: p[0], jogador1_nome: p[1], jogador1_avatar: p[2],
        jogador2_id: p[3], jogador2_nome: "Bot", jogador2_avatar: null,
        vez_de: null, vencedor_id: null, created_at: "", finished_at: null,
      });
      return { rows: [], meta: { changes: 1, last_row_id: id } };
    }
    if (s.startsWith("INSERT INTO partidas") && s.includes("VALUES ('aguardando'")) {
      const id = ++seqPartida;
      t.partidas.push({
        id, status: "aguardando", jogador1_id: p[0], jogador1_nome: p[1], jogador1_avatar: p[2],
        jogador2_id: null, jogador2_nome: null, jogador2_avatar: null,
        vez_de: null, vencedor_id: null, created_at: "", finished_at: null,
      });
      return { rows: [], meta: { changes: 1, last_row_id: id } };
    }
    if (s.startsWith("UPDATE partidas SET jogador2_id = ?")) {
      const r = t.partidas.find((x) => x.id === p[3]);
      if (!r || r.status !== "aguardando" || r.jogador2_id !== null) return semMudanca;
      Object.assign(r, { jogador2_id: p[0], jogador2_nome: p[1], jogador2_avatar: p[2], status: "posicionando" });
      return { rows: [], meta: { changes: 1 } };
    }
    if (s.startsWith("UPDATE partidas SET status = 'em_andamento', vez_de = jogador1_id")) {
      const r = t.partidas.find((x) => x.id === p[0]);
      if (!r || r.status !== "posicionando") return semMudanca;
      r.status = "em_andamento";
      r.vez_de = r.jogador1_id;
      return { rows: [], meta: { changes: 1 } };
    }
    if (s.startsWith("UPDATE partidas SET vez_de = ?")) {
      const r = t.partidas.find((x) => x.id === p[1]);
      const ok = Boolean(r) && r.vez_de === p[2] && r.status === "em_andamento";
      if (ok) r.vez_de = p[0];
      return { rows: [], meta: { changes: ok ? 1 : 0 } };
    }
    if (s.startsWith("UPDATE partidas SET status = 'finalizada'")) {
      const r = t.partidas.find((x) => x.id === p[1]);
      if (!r || r.status !== "em_andamento") return semMudanca;
      Object.assign(r, { status: "finalizada", vencedor_id: p[0], finished_at: "fim" });
      return { rows: [], meta: { changes: 1 } };
    }

    // ----- tabuleiros -----
    if (s.startsWith("INSERT INTO tabuleiros") && s.includes("ON CONFLICT(partida_id, jogador_id)")) {
      const r = t.tabuleiros.find((x) => x.partida_id === p[0] && x.jogador_id === p[1]);
      if (r) Object.assign(r, { navios_json: p[2], confirmado: 1 });
      else t.tabuleiros.push({ partida_id: p[0], jogador_id: p[1], navios_json: p[2], confirmado: 1 });
      return { rows: [], meta: { changes: 1 } };
    }
    if (s.startsWith("INSERT INTO tabuleiros")) {
      if (t.tabuleiros.some((x) => x.partida_id === p[0] && x.jogador_id === p[1])) unico("tabuleiros.PRIMARY KEY");
      t.tabuleiros.push({ partida_id: p[0], jogador_id: p[1], navios_json: p[2], confirmado: 1 });
      return { rows: [], meta: { changes: 1 } };
    }
    if (s.startsWith("SELECT confirmado FROM tabuleiros")) {
      const r = t.tabuleiros.find((x) => x.partida_id === p[0] && x.jogador_id === p[1]);
      return { rows: r ? [{ confirmado: r.confirmado }] : [], meta: {} };
    }
    if (s.includes("COUNT(*) AS total FROM tabuleiros")) {
      const total = t.tabuleiros.filter((x) => x.partida_id === p[0] && x.confirmado === 1).length;
      return { rows: [{ total }], meta: {} };
    }
    if (s.startsWith("SELECT jogador_id, navios_json, confirmado FROM tabuleiros")) {
      return { rows: clone(t.tabuleiros.filter((x) => x.partida_id === p[0])), meta: {} };
    }
    if (s.startsWith("SELECT navios_json FROM tabuleiros")) {
      const r = t.tabuleiros.find((x) => x.partida_id === p[0] && x.jogador_id === p[1]);
      return { rows: r ? [{ navios_json: r.navios_json }] : [], meta: {} };
    }

    // ----- tiros -----
    if (s.startsWith("INSERT INTO tiros")) {
      if (t.tiros.some((x) => x.partida_id === p[0] && x.atirador_id === p[1] && x.linha === p[2] && x.coluna === p[3])) {
        unico("tiros.UNIQUE(partida_id, atirador_id, linha, coluna)");
      }
      t.tiros.push({ id: ++seqTiro, partida_id: p[0], atirador_id: p[1], linha: p[2], coluna: p[3], resultado: p[4] });
      return { rows: [], meta: { changes: 1, last_row_id: seqTiro } };
    }
    if (s.startsWith("SELECT atirador_id, linha, coluna, resultado FROM tiros")) {
      const rows = t.tiros
        .filter((x) => x.partida_id === p[0])
        .sort((a, b) => a.id - b.id)
        .map(({ atirador_id, linha, coluna, resultado }) => ({ atirador_id, linha, coluna, resultado }));
      return { rows: clone(rows), meta: {} };
    }
    if (s.startsWith("SELECT linha, coluna FROM tiros")) {
      const rows = t.tiros
        .filter((x) => x.partida_id === p[0] && x.atirador_id === p[1])
        .map(({ linha, coluna }) => ({ linha, coluna }));
      return { rows: clone(rows), meta: {} };
    }
    if (s.startsWith("SELECT linha, coluna, resultado FROM tiros")) {
      const rows = t.tiros
        .filter((x) => x.partida_id === p[0] && x.atirador_id === p[1])
        .map(({ linha, coluna, resultado }) => ({ linha, coluna, resultado }));
      return { rows: clone(rows), meta: {} };
    }

    // ----- placar -----
    if (s.startsWith("INSERT INTO placar")) {
      const [uid, nome, avatar, vit, der] = p;
      const r = t.placar.find((x) => x.user_id === uid);
      if (r) {
        Object.assign(r, {
          username: nome, avatar, vitorias: r.vitorias + vit, derrotas: r.derrotas + der,
        });
      } else {
        t.placar.push({ user_id: uid, username: nome, avatar, vitorias: vit, derrotas: der });
      }
      return { rows: [], meta: { changes: 1 } };
    }
    if (s.startsWith("SELECT user_id, username, avatar, vitorias, derrotas FROM placar")) {
      const rows = t.placar
        .slice()
        .sort((a, b) => b.vitorias - a.vitorias || a.derrotas - b.derrotas || a.username.localeCompare(b.username))
        .slice(0, 20);
      return { rows: clone(rows), meta: {} };
    }

    throw new Error(`SQL não implementado no D1 falso: ${s}`);
  }

  return {
    estado: t,
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      let p = [];
      const st = {
        bind(...args) {
          p = args;
          return st;
        },
        async first() {
          return exec(s, p).rows[0] ?? null;
        },
        async all() {
          return { results: exec(s, p).rows };
        },
        async run() {
          const r = exec(s, p);
          return { results: r.rows, meta: r.meta, success: true };
        },
      };
      return st;
    },
  };
}

/* ---------- Auxiliares de requisição ---------- */
const novoEnv = () => ({ DB: criarD1(), SESSION_SECRET: SEGREDO });
const cookieDe = async (usuario) => `discord_session=${await assinarSessaoTeste(usuario, SEGREDO)}`;

async function chamar(handler, { env, metodo = "GET", id, corpo, ck }) {
  const headers = {};
  if (corpo !== undefined) headers["Content-Type"] = "application/json";
  if (ck) headers.Cookie = ck;
  const request = new Request("https://teste.local/api/partidas", {
    method: metodo,
    headers,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const res = await handler({ request, env, params: id !== undefined ? { id: String(id) } : {} });
  return { status: res.status, body: await res.json() };
}

const criarPartida = (env, ck, corpo = {}) =>
  chamar(colecao.onRequestPost, { env, metodo: "POST", corpo, ck });
const postPartida = (env, id, ck, corpo) =>
  chamar(partida.onRequestPost, { env, metodo: "POST", id, corpo, ck });
const getPartida = (env, id, ck) => chamar(partida.onRequestGet, { env, id, ck });
const posicionar = (env, id, ck, navios) => postPartida(env, id, ck, { acao: "posicionar", navios });
const entrar = (env, id, ck) => postPartida(env, id, ck, { acao: "entrar" });
const atirar = (env, id, ck, linha, coluna) => postPartida(env, id, ck, { acao: "atirar", linha, coluna });

/* ---------- Frotas e oráculo independente (não usa src/batalha.js) ---------- */
const H = (linha, coluna, tamanho) => ({ linha, coluna, tamanho, orientacao: "H" });
const V = (linha, coluna, tamanho) => ({ linha, coluna, tamanho, orientacao: "V" });
const FROTA_A = [H(0, 0, 5), H(2, 0, 4), H(4, 0, 3), H(6, 0, 3), H(8, 0, 2)];
const FROTA_B = [V(0, 9, 5), H(2, 4, 4), H(4, 4, 3), H(6, 4, 3), H(8, 8, 2)];

const celulasDe = (frota) =>
  frota.flatMap((n) =>
    Array.from({ length: n.tamanho }, (_, i) => (n.orientacao === "H" ? [n.linha, n.coluna + i] : [n.linha + i, n.coluna]))
  );
const chaveStr = ([l, c]) => `${l},${c}`;
const setA = new Set(celulasDe(FROTA_A).map(chaveStr));
const todasCasas = Array.from({ length: 100 }, (_, k) => [Math.floor(k / 10), k % 10]);
const aguaParaP2 = todasCasas.filter(([l, c]) => !setA.has(chaveStr([l, c])));
const alvosP1 = celulasDe(FROTA_B);

/** Navios como listas de chaves "l,c". */
const naviosChave = (frota) => frota.map((n) => celulasDe([n]).map(chaveStr));

/** Resultado esperado de um tiro: 'agua', 'acerto' ou 'afundado', dado o conjunto de casas já atingidas ANTES do tiro. */
function esperadoTiro(navios, jaTiradas, alvo) {
  const navio = navios.find((cs) => cs.includes(alvo));
  if (!navio) return "agua";
  return navio.every((c) => c === alvo || jaTiradas.has(c)) ? "afundado" : "acerto";
}

function contemChave(obj, chave) {
  if (Array.isArray(obj)) return obj.some((x) => contemChave(x, chave));
  if (obj && typeof obj === "object") {
    return Object.keys(obj).includes(chave) || Object.values(obj).some((v) => contemChave(v, chave));
  }
  return false;
}

/* ---------- Cenários reutilizáveis ---------- */
async function partidaHumana() {
  const env = novoEnv();
  const c1 = await cookieDe(P1);
  const c2 = await cookieDe(P2);
  const cria = await criarPartida(env, c1);
  assert.equal(cria.status, 201, "criação da partida humana");
  const id = cria.body.id;
  const ent = await entrar(env, id, c2);
  assert.equal(ent.status, 200, "entrada do segundo jogador");
  return { env, id, c1, c2 };
}

async function partidaEmAndamento() {
  const s = await partidaHumana();
  const a = await posicionar(s.env, s.id, s.c1, FROTA_A);
  assert.equal(a.status, 200, "posicionamento do jogador 1");
  assert.equal(a.body.iniciou, false, "primeiro posicionamento não inicia");
  const b = await posicionar(s.env, s.id, s.c2, FROTA_B);
  assert.equal(b.status, 200, "posicionamento do jogador 2");
  assert.equal(b.body.iniciou, true, "segundo posicionamento inicia a partida");
  return s;
}

/** Partida humana até o fim: P1 afunda a frota de P2 enquanto P2 dispara só em água. */
async function jogarHumanaAteFim(s) {
  const registro = [];
  let iP2 = 0;
  const tirosP1 = new Set();
  for (const [l, c] of alvosP1) {
    const alvo = chaveStr([l, c]);
    const r = await atirar(s.env, s.id, s.c1, l, c);
    assert.equal(r.status, 200, `tiro do jogador 1 em ${alvo}`);
    registro.push({ alvo, obtido: r.body.resultado, esperado: esperadoTiro(naviosChave(FROTA_B), tirosP1, alvo), venceu: r.body.venceu });
    tirosP1.add(alvo);
    if (r.body.venceu) break;
    const [l2, c2] = aguaParaP2[iP2++];
    const r2 = await atirar(s.env, s.id, s.c2, l2, c2);
    assert.equal(r2.status, 200, "tiro do jogador 2");
    assert.equal(r2.body.resultado, "agua", "tiro de P2 deve cair em água");
  }
  return registro;
}

/** Partida contra o bot: jogador 1 atira em todas as casas até o fim da partida. */
async function jogarContraBot() {
  const env = novoEnv();
  const c1 = await cookieDe(P1);
  const cria = await criarPartida(env, c1, { modo: "bot" });
  assert.equal(cria.status, 201, "criação da partida contra o bot");
  const id = cria.body.id;
  const pos = await posicionar(env, id, c1, FROTA_A);
  assert.equal(pos.status, 200, "posicionamento contra o bot");
  assert.equal(pos.body.iniciou, true, "bot já confirmado: posicionamento inicia a partida");

  const jogadasBot = [];
  const tirosBot = new Set();
  const resultadosJogador = [];
  const tirosJogador = new Set();
  let fimPorVenceu = false;
  let meio = null;
  let contador = 0;
  let codigoFim = null;

  for (const [l, c] of todasCasas) {
    const alvo = chaveStr([l, c]);
    const r = await atirar(env, id, c1, l, c);
    if (r.status === 409) {
      codigoFim = r;
      break;
    }
    assert.equal(r.status, 200, `tiro do jogador em ${alvo}`);
    resultadosJogador.push({ alvo, obtido: r.body.resultado });
    tirosJogador.add(alvo);
    contador++;

    if (contador === 10) {
      meio = await getPartida(env, id, c1);
    }
    if (r.body.venceu) {
      assert.equal(r.body.jogadaBot, null, "sem jogada do bot quando o jogador vence");
      fimPorVenceu = true;
      break;
    }
    const jb = r.body.jogadaBot;
    assert.ok(jb && typeof jb === "object", "jogadaBot ausente após tiro do jogador");
    assert.ok(["agua", "acerto", "afundado"].includes(jb.resultado), `resultado do bot inválido: ${jb.resultado}`);
    assert.ok(Number.isInteger(jb.linha) && jb.linha >= 0 && jb.linha <= 9, "linha do bot fora da malha");
    assert.ok(Number.isInteger(jb.coluna) && jb.coluna >= 0 && jb.coluna <= 9, "coluna do bot fora da malha");
    const kb = chaveStr([jb.linha, jb.coluna]);
    assert.equal(tirosBot.has(kb), false, `o bot repetiu a casa ${kb}`);
    jogadasBot.push({ alvo: kb, obtido: jb.resultado, esperado: esperadoTiro(naviosChave(FROTA_A), tirosBot, kb) });
    tirosBot.add(kb);
  }

  const final = await getPartida(env, id, c1);
  const botFrota = JSON.parse(env.DB.estado.tabuleiros.find((x) => x.jogador_id === BOT_ID).navios_json);
  // frota do bot lida do estado do D1 falso (oráculo para conferir os tiros do jogador)
  const naviosBot = botFrota.map((n) => n.celulas.map((k) => chaveStr([Math.floor(k / 10), k % 10])));
  const resultadosJogadorEsperados = resultadosJogador.map((x, i) => ({
    ...x,
    esperado: esperadoTiro(naviosBot, new Set(resultadosJogador.slice(0, i).map((y) => y.alvo)), x.alvo),
  }));
  return {
    env, id, c1, codigoFim, fimPorVenceu, meio, final, jogadasBot, resultadosJogador,
    resultadosJogadorEsperados,
  };
}

/* ---------- Runner ---------- */
const linhas = [];
async function teste(nome, esperado, fn) {
  let obtido;
  let passou;
  try {
    obtido = await fn();
    passou = true;
  } catch (e) {
    obtido = `FALHA: ${String(e.message).split("\n").slice(0, 4).join(" | ")}`;
    passou = false;
  }
  linhas.push({ nome, esperado, obtido, passou });
  console.log(`${passou ? "PASSOU" : "FALHOU"} | ${nome}\n   esperado: ${esperado}\n   obtido:   ${obtido}`);
}

/* ---------- Testes ---------- */
await teste("T1 POST /api/partidas sem cookie", "401", async () => {
  const r = await criarPartida(novoEnv(), undefined);
  assert.equal(r.status, 401);
  return `status ${r.status}, erro "${r.body.erro}"`;
});

await teste("T2 Posicionamento fora da malha", "422", async () => {
  const s = await partidaHumana();
  const fora = [H(0, 0, 5), H(2, 0, 4), H(4, 0, 3), H(6, 0, 3), H(8, 9, 2)]; // navio de 2 em colunas 9-10
  const r = await posicionar(s.env, s.id, s.c1, fora);
  assert.equal(r.status, 422);
  return `status ${r.status}, erro "${r.body.erro}"`;
});

await teste("T3 Posicionamento com sobreposição", "422", async () => {
  const s = await partidaHumana();
  const sobrep = [H(0, 0, 5), H(0, 2, 4), H(4, 0, 3), H(6, 0, 3), H(8, 0, 2)];
  const r = await posicionar(s.env, s.id, s.c1, sobrep);
  assert.equal(r.status, 422);
  return `status ${r.status}, erro "${r.body.erro}"`;
});

await teste("T4 Posicionamento com composição de frota errada", "422", async () => {
  const s = await partidaHumana();
  const errada = [H(0, 0, 5), H(2, 0, 5), H(4, 0, 3), H(6, 0, 3), H(8, 0, 2)]; // 5,5,3,3,2 em vez de 5,4,3,3,2
  const r = await posicionar(s.env, s.id, s.c1, errada);
  assert.equal(r.status, 422);
  return `status ${r.status}, erro "${r.body.erro}"`;
});

await teste("T4b Após recusas, frota válida ainda é aceita (recusa não grava nada)", "200, iniciou false", async () => {
  const s = await partidaHumana();
  await posicionar(s.env, s.id, s.c1, [H(0, 0, 5), H(0, 2, 4), H(4, 0, 3), H(6, 0, 3), H(8, 0, 2)]);
  await posicionar(s.env, s.id, s.c1, [H(0, 0, 5), H(2, 0, 5), H(4, 0, 3), H(6, 0, 3), H(8, 0, 2)]);
  const r = await posicionar(s.env, s.id, s.c1, FROTA_A);
  assert.equal(r.status, 200);
  assert.equal(r.body.iniciou, false);
  return `status ${r.status}, iniciou ${r.body.iniciou}`;
});

await teste("T5 Disparo fora da vez", "409 (\"Não é a sua vez.\")", async () => {
  const s = await partidaEmAndamento();
  const [l, c] = aguaParaP2[0];
  const r = await atirar(s.env, s.id, s.c2, l, c);
  assert.equal(r.status, 409);
  assert.equal(r.body.erro, "Não é a sua vez.");
  return `status ${r.status}, erro "${r.body.erro}"`;
});

await teste("T6 Disparo repetido na mesma casa", "409 (\"Você já atirou nesta posição.\")", async () => {
  const s = await partidaEmAndamento();
  const ok1 = await atirar(s.env, s.id, s.c1, 0, 0);
  assert.equal(ok1.status, 200);
  const [l2, c2] = aguaParaP2[0];
  const ok2 = await atirar(s.env, s.id, s.c2, l2, c2);
  assert.equal(ok2.status, 200);
  const rep = await atirar(s.env, s.id, s.c1, 0, 0);
  assert.equal(rep.status, 409);
  assert.equal(rep.body.erro, "Você já atirou nesta posição.");
  return `status ${rep.status}, erro "${rep.body.erro}"`;
});

await teste("T7 Coordenada inválida (10, -1, 10 em coluna)", "422 nos três casos", async () => {
  const s = await partidaEmAndamento();
  const casos = [[10, 0], [0, -1], [0, 10]];
  const obt = [];
  for (const [l, c] of casos) {
    const r = await atirar(s.env, s.id, s.c1, l, c);
    obt.push(`(${l},${c})->${r.status}`);
    assert.equal(r.status, 422, `coordenada (${l},${c})`);
  }
  // a vez do jogador 1 não deve ter sido consumida pelas tentativas inválidas
  const ok = await atirar(s.env, s.id, s.c1, 0, 0);
  assert.equal(ok.status, 200, "tiro válido após coordenadas inválidas");
  return obt.join(", ") + ", depois tiro válido -> 200";
});

await teste("T8 GET não expõe a frota do oponente antes do fim", "sem frota oponente; anônimo sem frota", async () => {
  const s = await partidaEmAndamento();
  await atirar(s.env, s.id, s.c1, 0, 0);
  await atirar(s.env, s.id, s.c2, 0, 5);

  const g1 = await getPartida(s.env, s.id, s.c1);
  assert.equal(g1.status, 200);
  assert.equal(g1.body.navioOponenteRevelado, null, "navioOponenteRevelado deve ser nulo");
  const semMeu1 = { ...g1.body, meuTabuleiro: undefined };
  assert.equal(contemChave(semMeu1, "celulas"), false, "P1 recebe estrutura de navios fora de meuTabuleiro");
  const celulasP1 = new Set(g1.body.meuTabuleiro.navios.flatMap((n) => n.celulas.map((x) => chaveStr([x.linha, x.coluna]))));
  assert.deepEqual([...celulasP1].sort(), [...setA].sort(), "meuTabuleiro de P1 deve ser a própria frota");

  const g2 = await getPartida(s.env, s.id, s.c2);
  assert.equal(g2.body.navioOponenteRevelado, null);
  assert.equal(contemChave({ ...g2.body, meuTabuleiro: undefined }, "celulas"), false, "P2 recebe navios fora de meuTabuleiro");

  const anon = await getPartida(s.env, s.id, undefined);
  assert.equal(anon.body.meuTabuleiro, null);
  assert.equal(anon.body.navioOponenteRevelado, null);
  assert.equal(contemChave(anon.body, "celulas"), false, "anônimo recebe navios");
  return "navioOponenteRevelado=null; sem chave 'celulas' fora de meuTabuleiro (P1, P2 e anônimo)";
});

await teste("T9 Bot: após o disparo do jogador, jogadaBot válido", "200 com jogadaBot {linha,coluna,resultado in agua|acerto|afundado}", async () => {
  const env = novoEnv();
  const c1 = await cookieDe(P1);
  const cria = await criarPartida(env, c1, { modo: "bot" });
  assert.equal(cria.status, 201);
  const pos = await posicionar(env, cria.body.id, c1, FROTA_A);
  assert.equal(pos.body.iniciou, true);
  const r = await atirar(env, cria.body.id, c1, 0, 0);
  assert.equal(r.status, 200);
  const jb = r.body.jogadaBot;
  assert.ok(jb && typeof jb === "object", "jogadaBot ausente");
  assert.ok(["agua", "acerto", "afundado"].includes(jb.resultado), `resultado inválido: ${jb.resultado}`);
  assert.ok(jb.linha >= 0 && jb.linha <= 9 && jb.coluna >= 0 && jb.coluna <= 9);
  return `jogadaBot = (${jb.linha},${jb.coluna}) ${jb.resultado}`;
});

const bot = await jogarContraBot();

await teste("T10 Bot nunca repete casa, em partida completa", "nenhuma casa repetida; resultados do bot coerentes com a frota do jogador", async () => {
  assert.ok(
    bot.fimPorVenceu || bot.codigoFim?.body?.erro === "A partida não está em andamento.",
    "a partida deve terminar: vitória do jogador, ou 409 após vitória do bot"
  );
  const incoerentes = bot.jogadasBot.filter((x) => x.obtido !== x.esperado);
  assert.equal(incoerentes.length, 0, `tiros do bot incoerentes: ${JSON.stringify(incoerentes.slice(0, 3))}`);
  const repetidas = bot.jogadasBot.length - new Set(bot.jogadasBot.map((x) => x.alvo)).size;
  assert.equal(repetidas, 0);
  return `${bot.jogadasBot.length} tiros do bot, sem repetição, todos coerentes com ${FROTA_A.length} navios do jogador`;
});

await teste("T10b Resultados dos tiros do jogador coincidem com a frota do bot", "todos coerentes", async () => {
  const incoerentes = bot.resultadosJogador.filter((x, i) => x.obtido !== bot.resultadosJogadorEsperados[i].esperado);
  assert.equal(incoerentes.length, 0, `incoerentes: ${JSON.stringify(incoerentes.slice(0, 3))}`);
  return `${bot.resultadosJogador.length} tiros do jogador conferidos contra a frota do bot`;
});

await teste("T10c GET durante partida contra o bot não expõe a frota do bot", "sem chave 'celulas' fora de meuTabuleiro; navioOponenteRevelado nulo", async () => {
  assert.ok(bot.meio, "GET do meio da partida não foi feito");
  assert.equal(bot.meio.body.navioOponenteRevelado, null);
  assert.equal(contemChave({ ...bot.meio.body, meuTabuleiro: undefined }, "celulas"), false);
  return "GET no décimo tiro não revela navios do bot";
});

await teste("T11 Partida finalizada: placar do vencedor e do perdedor incrementado uma única vez", "P1 vitorias 1/derrotas 0; P2 vitorias 0/derrotas 1; nova jogada recusada", async () => {
  const s = await partidaEmAndamento();
  const reg = await jogarHumanaAteFim(s);
  const ultimo = reg[reg.length - 1];
  assert.equal(ultimo.venceu, true, "último tiro de P1 deve vencer");
  const incoerentes = reg.filter((x) => x.obtido !== x.esperado);
  assert.equal(incoerentes.length, 0, `classificação incoerente: ${JSON.stringify(incoerentes.slice(0, 3))}`);

  const fim = await getPartida(s.env, s.id, s.c1);
  assert.equal(fim.body.partida.status, "finalizada");
  assert.equal(fim.body.partida.vencedorId, P1.userId);
  assert.ok(fim.body.navioOponenteRevelado, "após o fim, a frota do oponente deve ser revelada");

  const pl1 = await placarApi.onRequestGet({ request: new Request("https://teste.local/api/placar"), env: s.env, params: {} });
  const placar1 = await pl1.json();
  const ent = (id) => placar1.placar.find((x) => x.user_id === id);
  assert.deepEqual([ent(P1.userId).vitorias, ent(P1.userId).derrotas], [1, 0], "placar do vencedor após o fim");
  assert.deepEqual([ent(P2.userId).vitorias, ent(P2.userId).derrotas], [0, 1], "placar do perdedor após o fim");

  const tardio = await atirar(s.env, s.id, s.c1, 0, 0);
  assert.equal(tardio.status, 409);
  assert.equal(tardio.body.erro, "A partida não está em andamento.");

  const pl2 = await placarApi.onRequestGet({ request: new Request("https://teste.local/api/placar"), env: s.env, params: {} });
  const placar2 = await pl2.json();
  const ent2 = (id) => placar2.placar.find((x) => x.user_id === id);
  assert.deepEqual([ent2(P1.userId).vitorias, ent2(P1.userId).derrotas], [1, 0], "placar mudou após jogada recusada");
  assert.deepEqual([ent2(P2.userId).vitorias, ent2(P2.userId).derrotas], [0, 1], "placar mudou após jogada recusada");
  return "vencedor 1V/0D, perdedor 0V/1D; após o fim, jogada recusada (409) e placar inalterado";
});

await teste("T12 Partida contra o bot: placar só para o jogador humano", "uma linha para P1 com soma 1; nenhuma linha 'bot'", async () => {
  const pl = await placarApi.onRequestGet({ request: new Request("https://teste.local/api/placar"), env: bot.env, params: {} });
  const placar = await pl.json();
  assert.equal(placar.placar.some((x) => x.user_id === BOT_ID), false, "bot recebeu linha no placar");
  const linhaP1 = placar.placar.find((x) => x.user_id === P1.userId);
  assert.ok(linhaP1, "jogador humano sem linha no placar");
  assert.equal(linhaP1.vitorias + linhaP1.derrotas, 1, "jogador deveria ter exatamente 1 partida contabilizada");
  return `P1: ${linhaP1.vitorias}V/${linhaP1.derrotas}D; bot sem linha; vencedor: ${bot.final.body.partida.vencedorId}`;
});

const ok = linhas.filter((l) => l.passou).length;
const relatorio = [
  "| # | Teste | Esperado | Obtido | Status |",
  "|---|---|---|---|---|",
  ...linhas.map((l, i) => `| ${i + 1} | ${l.nome} | ${l.esperado} | ${l.obtido} | ${l.passou ? "PASSOU" : "FALHOU"} |`),
  "",
  `Total: ${ok}/${linhas.length} PASSOU`,
].join("\n");
console.log("\n" + relatorio);
