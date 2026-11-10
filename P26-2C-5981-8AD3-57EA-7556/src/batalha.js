/**
 * Regras puras do Batalha Naval Tático (usadas pelas Cloudflare Functions).
 * Zero dependências. A malha tem índices 0..9; cada célula é codificada como linha * 10 + coluna.
 */
export const TAMANHO = 10;
export const FROTA = [5, 4, 3, 3, 2];

export const erro = (mensagem, status = 400) =>
  Response.json({ ok: false, erro: mensagem }, { status });

const inteiroEntre = (valor, min, max) => Number.isInteger(valor) && valor >= min && valor <= max;

export const chave = (linha, coluna) => linha * TAMANHO + coluna;
export const coordenadas = (k) => ({ linha: Math.floor(k / TAMANHO), coluna: k % TAMANHO });
export const validarCoordenada = (linha, coluna) =>
  inteiroEntre(linha, 0, TAMANHO - 1) && inteiroEntre(coluna, 0, TAMANHO - 1);

/**
 * Valida a frota enviada pelo cliente: 5 navios, composição exata da FROTA,
 * todos dentro da malha 10x10 e sem sobreposição. Retorna os navios com as células calculadas.
 */
export function validarFrota(entrada) {
  if (!Array.isArray(entrada) || entrada.length !== FROTA.length) {
    return { ok: false, erro: `A frota deve conter exatamente ${FROTA.length} navios.` };
  }
  const ocupadas = new Set();
  const navios = [];
  for (const item of entrada) {
    const { linha, coluna, tamanho, orientacao } = item ?? {};
    if (
      !inteiroEntre(linha, 0, TAMANHO - 1) ||
      !inteiroEntre(coluna, 0, TAMANHO - 1) ||
      !FROTA.includes(tamanho) ||
      (orientacao !== "H" && orientacao !== "V")
    ) {
      return { ok: false, erro: "Navio com dados inválidos." };
    }
    const celulas = [];
    for (let i = 0; i < tamanho; i++) {
      const l = orientacao === "V" ? linha + i : linha;
      const c = orientacao === "H" ? coluna + i : coluna;
      if (l >= TAMANHO || c >= TAMANHO) {
        return { ok: false, erro: "Navio ultrapassa os limites da malha 10x10." };
      }
      const k = chave(l, c);
      if (ocupadas.has(k)) return { ok: false, erro: "Navios não podem se sobrepor." };
      ocupadas.add(k);
      celulas.push(k);
    }
    navios.push({ tamanho, celulas });
  }
  const enviados = navios.map((n) => n.tamanho).sort((a, b) => a - b).join(",");
  const esperados = [...FROTA].sort((a, b) => a - b).join(",");
  if (enviados !== esperados) return { ok: false, erro: "Composição da frota incorreta." };
  return { ok: true, navios };
}

/** Classifica um tiro como "agua", "acerto" ou "afundado" sem revelar o navio ao oponente. */
export function classificarTiro(navios, alvo, jaTiradas) {
  const navio = navios.find((n) => n.celulas.includes(alvo));
  if (!navio) return "agua";
  const todasAtingidas = navio.celulas.every((c) => c === alvo || jaTiradas.has(c));
  return todasAtingidas ? "afundado" : "acerto";
}

/** true quando todas as células de todos os navios estão em `tiradas`. */
export const todosAfundados = (navios, tiradas) =>
  navios.every((n) => n.celulas.every((c) => tiradas.has(c)));

/* ---------- Esquema do D1 (criado sob demanda, idempotente) ---------- */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS partidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL CHECK (status IN ('aguardando', 'posicionando', 'em_andamento', 'finalizada')),
    jogador1_id TEXT NOT NULL,
    jogador1_nome TEXT NOT NULL,
    jogador1_avatar TEXT,
    jogador2_id TEXT,
    jogador2_nome TEXT,
    jogador2_avatar TEXT,
    vez_de TEXT,
    vencedor_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS tabuleiros (
    partida_id INTEGER NOT NULL REFERENCES partidas(id),
    jogador_id TEXT NOT NULL,
    navios_json TEXT NOT NULL,
    confirmado INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (partida_id, jogador_id)
  )`,
  `CREATE TABLE IF NOT EXISTS tiros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partida_id INTEGER NOT NULL REFERENCES partidas(id),
    atirador_id TEXT NOT NULL,
    linha INTEGER NOT NULL CHECK (linha BETWEEN 0 AND 9),
    coluna INTEGER NOT NULL CHECK (coluna BETWEEN 0 AND 9),
    resultado TEXT NOT NULL CHECK (resultado IN ('agua', 'acerto', 'afundado')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (partida_id, atirador_id, linha, coluna)
  )`,
  `CREATE TABLE IF NOT EXISTS placar (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    avatar TEXT,
    vitorias INTEGER NOT NULL DEFAULT 0,
    derrotas INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_partidas_status ON partidas(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tiros_partida ON tiros(partida_id)`,
];

let esquemaPronto = false;

export async function garantirSchema(DB) {
  if (esquemaPronto) return;
  for (const sql of SCHEMA) await DB.prepare(sql).run();
  esquemaPronto = true;
}

/**
 * Envolve um handler: exige o binding D1, garante o esquema e devolve
 * a mensagem real do erro (em vez de um 500 genérico) se o banco falhar.
 */
export function comBanco(handler) {
  return async (context) => {
    if (!context.env.DB) return erro("Banco D1 não vinculado ao projeto (binding DB).", 503);
    try {
      await garantirSchema(context.env.DB);
      return await handler(context);
    } catch (e) {
      console.error(e);
      return erro("Erro no banco de dados: " + (e?.message || String(e)), 500);
    }
  };
}

/* ---------- Bot ---------- */
export const BOT_ID = "bot";

/** Gera uma frota aleatória válida para o bot (navios em linha reta, sem sobreposição, dentro da malha). */
export function frotaAleatoria() {
  for (let tentativa = 0; tentativa < 1000; tentativa++) {
    const ocupadas = new Set();
    const navios = [];
    let ok = true;
    for (const tamanho of FROTA) {
      let colocado = false;
      for (let t = 0; t < 200 && !colocado; t++) {
        const orientacao = Math.random() < 0.5 ? "H" : "V";
        const linha = Math.floor(Math.random() * TAMANHO);
        const coluna = Math.floor(Math.random() * TAMANHO);
        const celulas = [];
        let valido = true;
        for (let i = 0; i < tamanho; i++) {
          const l = orientacao === "V" ? linha + i : linha;
          const c = orientacao === "H" ? coluna + i : coluna;
          if (l >= TAMANHO || c >= TAMANHO || ocupadas.has(chave(l, c))) {
            valido = false;
            break;
          }
          celulas.push(chave(l, c));
        }
        if (valido) {
          celulas.forEach((k) => ocupadas.add(k));
          navios.push({ tamanho, celulas });
          colocado = true;
        }
      }
      if (!colocado) {
        ok = false;
        break;
      }
    }
    if (ok) return navios;
  }
  throw new Error("Não foi possível gerar a frota do bot.");
}

/** Próximo tiro do bot: casas vizinhas de acertos ainda não atirados; senão, uma casa livre ao acaso. */
export function escolherAlvoBot(tiradas, historico) {
  const candidatos = new Set();
  for (const t of historico) {
    if (t.resultado !== "acerto") continue;
    for (const [dl, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const l = t.linha + dl;
      const c = t.coluna + dc;
      if (inteiroEntre(l, 0, TAMANHO - 1) && inteiroEntre(c, 0, TAMANHO - 1) && !tiradas.has(chave(l, c))) {
        candidatos.add(chave(l, c));
      }
    }
  }
  const lista = candidatos.size
    ? [...candidatos]
    : Array.from({ length: TAMANHO * TAMANHO }, (_, k) => k).filter((k) => !tiradas.has(k));
  return lista[Math.floor(Math.random() * lista.length)];
}
