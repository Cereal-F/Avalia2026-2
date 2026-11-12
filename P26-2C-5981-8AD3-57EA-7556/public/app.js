const TAMANHO = 10;
const FROTA = [5, 4, 3, 3, 2];
const NOMES_NAVIOS = { 5: "Porta-aviões", 4: "Encouraçado", 3: "Cruzador", 2: "Submarino" };
const INTERVALO_MS = 3000;
const MENSAGENS_TIRO = { agua: "Água! Nenhum navio atingido.", acerto: "Acertou um navio!", afundado: "Navio afundado!" };

const $ = (id) => document.getElementById(id);
const chave = (linha, coluna) => linha * TAMANHO + coluna;

const app = {
  usuario: null,
  partidaId: null,
  estado: null,        // última resposta de GET /api/partidas/:id
  posicionamento: [],  // navios colocados nesta fase: {linha, coluna, tamanho, orientacao, celulas}
  orientacao: "H",
  timer: null,
  seq: 0,
};

async function api(url, opcoes = {}) {
  const res = await fetch(url, {
    method: opcoes.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok || dados.ok === false) {
    throw new Error(dados.erro || "Falha na requisição (HTTP " + res.status + ").");
  }
  return dados;
}

function mensagem(id, texto, erro = false) {
  const el = $(id);
  el.textContent = texto;
  el.classList.toggle("erro", erro);
}

function rotuloStatus(status) {
  return {
    aguardando: "Aguardando oponente",
    posicionando: "Posicionando frotas",
    em_andamento: "Em andamento",
    finalizada: "Finalizada",
  }[status] || status;
}

function botao(texto, classe, aoClicar) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = classe;
  b.textContent = texto;
  b.addEventListener("click", aoClicar);
  return b;
}

/* ---------- Sessão Discord ---------- */

async function carregarSessao() {
  const d = await api("/api/sessao");
  app.usuario = d.logado ? d.usuario : null;
  const link = $("discordLoginLink");
  const texto = $("discordUserText");
  link.replaceChildren();
  if (app.usuario) {
    link.removeAttribute("href");
    if (app.usuario.avatar) {
      const img = document.createElement("img");
      img.src = app.usuario.avatar;
      img.alt = "";
      img.width = 24;
      img.height = 24;
      img.className = "avatar";
      link.appendChild(img);
    }
    texto.textContent = "Discord: " + app.usuario.username;
  } else {
    link.href = "/api/auth/discord";
    texto.textContent = d.configurado ? "Entrar com Discord OAuth2" : "Discord OAuth2 não configurado";
  }
  link.appendChild(texto);
}

/* ---------- Lobby ---------- */

async function carregarLobby() {
  const { partidas } = await api("/api/partidas");
  const lista = $("listaPartidas");
  lista.replaceChildren();
  if (!partidas.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhuma partida disponível no momento.";
    lista.appendChild(li);
    return;
  }
  for (const p of partidas) {
    const li = document.createElement("li");
    li.className = "item-partida";
    const info = document.createElement("span");
    const nomes = p.jogador2_nome ? `${p.jogador1_nome} vs ${p.jogador2_nome}` : p.jogador1_nome;
    info.textContent = `#${p.id} · ${nomes} · ${rotuloStatus(p.status)}`;
    li.appendChild(info);
    const participo = app.usuario && (p.jogador1_id === app.usuario.userId || p.jogador2_id === app.usuario.userId);
    if (participo) {
      li.appendChild(botao("Abrir", "btn-primary", () => abrirPartida(p.id)));
    } else if (p.status === "aguardando" && app.usuario) {
      li.appendChild(botao("Entrar", "btn-primary", () => entrarPartida(p.id)));
    }
    lista.appendChild(li);
  }
}

async function criarPartida(modo = "humano") {
  if (!app.usuario) return mensagem("mensagemLobby", "Faça login com Discord para criar partidas.", true);
  const botoes = [$("btnCriar"), $("btnBot")];
  botoes.forEach((b) => (b.disabled = true));
  try {
    const d = await api("/api/partidas", { method: "POST", corpo: { modo } });
    mensagem("mensagemLobby", modo === "bot" ? "Partida contra o bot criada. Posicione sua frota." : "Partida criada. Aguardando um oponente.");
    await carregarLobby();
    await abrirPartida(d.id);
  } catch (e) {
    mensagem("mensagemLobby", e.message, true);
  } finally {
    botoes.forEach((b) => (b.disabled = false));
  }
}

async function entrarPartida(id) {
  try {
    await api(`/api/partidas/${id}`, { method: "POST", corpo: { acao: "entrar" } });
    await carregarLobby();
    await abrirPartida(id);
  } catch (e) {
    mensagem("mensagemLobby", e.message, true);
  }
}

/* ---------- Partida ---------- */

async function abrirPartida(id) {
  if (app.partidaId !== id) {
    app.posicionamento = [];
    mensagem("mensagemPartida", "");
  }
  app.partidaId = id;
  $("secaoPartida").hidden = false;
  await atualizarPartida();
  $("secaoPartida").scrollIntoView({ behavior: "smooth" });
}

async function atualizarPartida() {
  clearTimeout(app.timer);
  if (!app.partidaId) return;
  const seq = ++app.seq;
  let novo;
  try {
    novo = await api(`/api/partidas/${app.partidaId}`);
  } catch (e) {
    if (seq !== app.seq) return;
    mensagem("mensagemPartida", e.message, true);
    if (!app.estado || app.estado.partida.status !== "finalizada") agendar(INTERVALO_MS * 2);
    return;
  }
  if (seq !== app.seq) return; // uma atualização mais recente já assumiu o controle
  if (JSON.stringify(novo) !== JSON.stringify(app.estado)) {
    app.estado = novo;
    renderizarPartida();
  }

  const { partida, papel } = app.estado;
  if (partida.status === "finalizada") carregarPlacar().catch(() => {});

  const minhaVez = partida.vezDe === app.usuario?.userId;
  const aguardando =
    partida.status === "aguardando" ||
    partida.status === "posicionando" ||
    (partida.status === "em_andamento" && !minhaVez);
  if (papel && aguardando) agendar(INTERVALO_MS);
}

function agendar(ms) {
  clearTimeout(app.timer);
  app.timer = setTimeout(atualizarPartida, ms);
}

function renderizarPartida() {
  const { partida, papel, euConfirmei } = app.estado;
  const minhaVez = partida.vezDe === app.usuario?.userId;
  const posicionando = partida.status === "posicionando" && papel && !euConfirmei;

  $("pillStatus").textContent = rotuloStatus(partida.status);
  const j1 = partida.jogador1?.nome || "Jogador 1";
  const j2 = partida.jogador2?.nome || "aguardando oponente";
  $("tituloPartida").textContent = `Partida #${partida.id}: ${j1} vs ${j2}`;

  let instrucao = "";
  if (partida.status === "aguardando") {
    instrucao = "Aguardando um oponente entrar na partida.";
  } else if (partida.status === "posicionando") {
    instrucao = !papel
      ? "Partida em fase de posicionamento."
      : euConfirmei
        ? "Frota confirmada. Aguardando o oponente posicionar a frota."
        : "Posicione sua frota: escolha a orientação e clique na malha. Os navios não podem se sobrepor nem sair da malha.";
  } else if (partida.status === "em_andamento") {
    instrucao = minhaVez
      ? "Sua vez! Clique em uma posição do radar para atirar."
      : "Aguardando a jogada do oponente.";
  } else if (partida.status === "finalizada") {
    if (!papel) instrucao = "Partida encerrada.";
    else instrucao = partida.vencedorId === app.usuario?.userId ? "Você venceu a partida!" : "Fim de jogo: seu oponente venceu.";
  }
  $("instrucaoPartida").textContent = instrucao;

  $("painelPosicionamento").hidden = !posicionando;
  if (posicionando) atualizarControlesPosicionamento();

  renderizarGrades();
}

/* ---------- Posicionamento ---------- */

function celulasDoNavio(linha, coluna, tamanho, orientacao) {
  const celulas = [];
  for (let i = 0; i < tamanho; i++) {
    const l = orientacao === "V" ? linha + i : linha;
    const c = orientacao === "H" ? coluna + i : coluna;
    if (l >= TAMANHO || c >= TAMANHO) return null;
    celulas.push(chave(l, c));
  }
  return celulas;
}

const proximoTamanho = () => FROTA[app.posicionamento.length];

function ocupadasPelaFrota() {
  const ocupadas = new Set();
  app.posicionamento.forEach((n) => n.celulas.forEach((k) => ocupadas.add(k)));
  return ocupadas;
}

function tentarPosicionar(linha, coluna) {
  const tamanho = proximoTamanho();
  if (!tamanho) return;
  const celulas = celulasDoNavio(linha, coluna, tamanho, app.orientacao);
  const ocupadas = ocupadasPelaFrota();
  if (!celulas || celulas.some((k) => ocupadas.has(k))) {
    return mensagem("mensagemPartida", "Posição inválida: fora da malha ou sobreposta a outro navio.", true);
  }
  app.posicionamento.push({ linha, coluna, tamanho, orientacao: app.orientacao, celulas });
  mensagem("mensagemPartida", "");
  atualizarControlesPosicionamento();
  renderizarGrades();
}

function mostrarPrevia(linha, coluna) {
  limparPrevia();
  const tamanho = proximoTamanho();
  if (!tamanho) return;
  const celulas = celulasDoNavio(linha, coluna, tamanho, app.orientacao);
  if (!celulas) return;
  const ocupadas = ocupadasPelaFrota();
  const valida = !celulas.some((k) => ocupadas.has(k));
  document.querySelectorAll("#gradeMinha .celula").forEach((b) => {
    if (celulas.includes(chave(Number(b.dataset.l), Number(b.dataset.c)))) {
      b.classList.add(valida ? "previa" : "previa-invalida");
    }
  });
}

function limparPrevia() {
  document.querySelectorAll("#gradeMinha .previa, #gradeMinha .previa-invalida").forEach((b) => {
    b.classList.remove("previa", "previa-invalida");
  });
}

function atualizarControlesPosicionamento() {
  const tamanho = proximoTamanho();
  const orientacaoTexto = app.orientacao === "H" ? "horizontal" : "vertical";
  $("proximoNavio").textContent = tamanho
    ? `Próximo navio: ${NOMES_NAVIOS[tamanho]} (${tamanho} casas). Orientação atual: ${orientacaoTexto}.`
    : "Frota completa. Confira a posição e confirme.";
  $("btnConfirmar").disabled = tamanho !== undefined;
  $("btnOrientacao").textContent = "Orientação: " + (app.orientacao === "H" ? "Horizontal" : "Vertical");
}

async function confirmarFrota() {
  $("btnConfirmar").disabled = true;
  try {
    const navios = app.posicionamento.map((n) => ({
      linha: n.linha,
      coluna: n.coluna,
      tamanho: n.tamanho,
      orientacao: n.orientacao,
    }));
    const d = await api(`/api/partidas/${app.partidaId}`, { method: "POST", corpo: { acao: "posicionar", navios } });
    app.posicionamento = [];
    mensagem("mensagemPartida", d.iniciou ? "Frotas prontas! A batalha começou." : "Frota confirmada!");
    await atualizarPartida();
  } catch (e) {
    mensagem("mensagemPartida", e.message, true);
    $("btnConfirmar").disabled = false;
  }
}

/* ---------- Combate ---------- */

async function atirar(linha, coluna) {
  try {
    const r = await api(`/api/partidas/${app.partidaId}`, {
      method: "POST",
      corpo: { acao: "atirar", linha, coluna },
    });
    const TEXTO_BOT = { agua: "errou", acerto: "acertou um navio", afundado: "afundou um navio" };
    let texto = MENSAGENS_TIRO[r.resultado] || "Tiro registrado.";
    if (r.jogadaBot) texto += " Bot: " + TEXTO_BOT[r.jogadaBot.resultado] + ".";
    mensagem("mensagemPartida", texto);
  } catch (e) {
    mensagem("mensagemPartida", e.message, true);
  }
  await atualizarPartida();
}

/* ---------- Grades ---------- */

function criarCelula(linha, coluna) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "celula";
  b.dataset.l = linha;
  b.dataset.c = coluna;
  b.setAttribute("aria-label", `Linha ${linha + 1}, coluna ${coluna + 1}`);
  return b;
}

function renderizarGrades() {
  if (!app.estado) return;
  const { partida, papel, euConfirmei, meuTabuleiro, tirosRecebidos, meusTiros, navioOponenteRevelado } = app.estado;
  const posicionando = partida.status === "posicionando" && papel && !euConfirmei;
  const minhaVez = partida.vezDe === app.usuario?.userId;
  const emJogo = partida.status === "em_andamento" && papel && minhaVez;

  const naviosMeus = posicionando
    ? app.posicionamento.map((n) => n.celulas)
    : (meuTabuleiro?.navios || []).map((n) => n.celulas.map((c) => chave(c.linha, c.coluna)));
  const minhasCelulas = new Set(naviosMeus.flat());
  const recebidos = new Map(tirosRecebidos.map((t) => [chave(t.linha, t.coluna), t.resultado]));
  const meus = new Map(meusTiros.map((t) => [chave(t.linha, t.coluna), t.resultado]));
  const revelados = new Set((navioOponenteRevelado || []).flatMap((n) => n.celulas.map((c) => chave(c.linha, c.coluna))));

  const gradeMinha = $("gradeMinha");
  const gradeRadar = $("gradeRadar");
  gradeMinha.replaceChildren();
  gradeRadar.replaceChildren();

  for (let l = 0; l < TAMANHO; l++) {
    for (let c = 0; c < TAMANHO; c++) {
      const k = chave(l, c);

      const cm = criarCelula(l, c);
      if (minhasCelulas.has(k)) cm.classList.add("navio");
      if (recebidos.has(k)) cm.classList.add("tiro-" + recebidos.get(k));
      if (posicionando) {
        cm.disabled = false;
        cm.addEventListener("click", () => tentarPosicionar(l, c));
        cm.addEventListener("mouseenter", () => mostrarPrevia(l, c));
        cm.addEventListener("mouseleave", limparPrevia);
      } else {
        cm.disabled = true;
      }
      gradeMinha.appendChild(cm);

      const cr = criarCelula(l, c);
      if (meus.has(k)) cr.classList.add("tiro-" + meus.get(k));
      if (revelados.has(k)) cr.classList.add("revelado");
      const clicavel = emJogo && !meus.has(k);
      cr.disabled = !clicavel;
      if (clicavel) cr.addEventListener("click", () => atirar(l, c));
      gradeRadar.appendChild(cr);
    }
  }
}

/* ---------- Placar ---------- */

async function carregarPlacar() {
  const { placar } = await api("/api/placar");
  const corpo = $("corpoPlacar");
  corpo.replaceChildren();
  if (!placar.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "Nenhuma partida finalizada ainda.";
    tr.appendChild(td);
    corpo.appendChild(tr);
    return;
  }
  placar.forEach((p, i) => {
    const tr = document.createElement("tr");
    [i + 1, p.username, p.vitorias, p.derrotas].forEach((valor) => {
      const td = document.createElement("td");
      td.textContent = String(valor);
      tr.appendChild(td);
    });
    corpo.appendChild(tr);
  });
}

/* ---------- Inicialização ---------- */

$("btnCriar").addEventListener("click", () => criarPartida("humano"));
$("btnBot").addEventListener("click", () => criarPartida("bot"));
$("btnAtualizarLobby").addEventListener("click", () =>
  carregarLobby().catch((e) => mensagem("mensagemLobby", e.message, true))
);
$("btnOrientacao").addEventListener("click", () => {
  app.orientacao = app.orientacao === "H" ? "V" : "H";
  atualizarControlesPosicionamento();
});
$("btnLimpar").addEventListener("click", () => {
  app.posicionamento = [];
  atualizarControlesPosicionamento();
  renderizarGrades();
});
$("btnConfirmar").addEventListener("click", confirmarFrota);

(async function iniciar() {
  try {
    await carregarSessao();
  } catch (e) {
    mensagem("mensagemLobby", "Não foi possível verificar a sessão: " + e.message, true);
  }
  await Promise.all([
    carregarLobby().catch((e) => mensagem("mensagemLobby", e.message, true)),
    carregarPlacar().catch(() => {}),
  ]);
})();
