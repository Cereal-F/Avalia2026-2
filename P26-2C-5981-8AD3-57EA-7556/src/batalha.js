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
