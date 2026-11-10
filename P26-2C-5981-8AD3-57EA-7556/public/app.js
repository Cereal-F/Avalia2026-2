const CHAVE_PROJETO = "P26-2C-5981-8AD3-57EA-7556";

const discordSession = {
  user_id: "discord_" + CHAVE_PROJETO.slice(-4).toLowerCase(),
  username: "Pedro",
  avatar: "https://cdn.discordapp.com/embed/avatars/0.png",
};

function renderDiscordHeader() {
  const el = document.getElementById("discordUserText");
  if (el) {
    el.textContent = "Discord: " + discordSession.username + " (" + discordSession.user_id + ")";
  }
}

async function carregarStatus() {
  const listEl = document.getElementById("recordsList");
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    listEl.innerHTML = "";
        if (data.sessionUser) {
      discordSession.user_id = data.sessionUser.userId;
      discordSession.username = data.sessionUser.username;
      discordSession.avatar = data.sessionUser.avatar || discordSession.avatar;
      renderDiscordHeader();
    }
    const items = Array.isArray(data.ultimosRegistros) ? data.ultimosRegistros : [];
    if (items.length === 0) {
      const li = document.createElement("li");
      li.textContent = "API Online (" + (data.d1Connected ? "D1 Conectado ✅" : "Modo Diagnóstico Serverless ✅") + "). Nenhum registro gravado ainda.";
      listEl.appendChild(li);
      return;
    }
    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = "[" + (item.created_at || "agora") + "] " + item.username + " (" + item.user_id + "): " + item.conteudo;
      listEl.appendChild(li);
    });
  } catch (err) {
    listEl.innerHTML = "<li>Modo estático local. Publique no Cloudflare Pages para ativar /api/status.</li>";
  }
}

document.getElementById("sendBtn")?.addEventListener("click", async () => {
  const input = document.getElementById("recordInput");
  const statusEl = document.getElementById("statusMessage");
  const conteudo = (input.value || "").trim();
  if (!conteudo) return;

  statusEl.textContent = "Enviando para Cloudflare Function...";
  try {
    const res = await fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: discordSession.user_id,
        username: discordSession.username,
        conteudo,
      }),
    });
    if (res.ok) {
      input.value = "";
      statusEl.textContent = "✓ Registro validado e processado na borda!";
      await carregarStatus();
    } else {
      statusEl.textContent = "Erro ao registrar.";
    }
  } catch {
    statusEl.textContent = "API disponível após o deploy no Cloudflare Pages.";
  }
});

renderDiscordHeader();
carregarStatus();
