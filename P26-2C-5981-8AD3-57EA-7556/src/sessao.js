/**
 * Sessão Discord assinada (HMAC-SHA256) em cookie HttpOnly.
 * O servidor só aceita a identidade do jogador se a assinatura bater com o segredo do Pages.
 */
const codificador = new TextEncoder();
const decodificador = new TextDecoder();

function paraBase64Url(bytes) {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(texto) {
  const padrao = texto.replace(/-/g, "+").replace(/_/g, "/");
  const completo = padrao + "=".repeat((4 - (padrao.length % 4)) % 4);
  return Uint8Array.from(atob(completo), (c) => c.charCodeAt(0));
}

function chaveHmac(segredo) {
  return crypto.subtle.importKey(
    "raw",
    codificador.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export function segredoSessao(env) {
  return env.SESSION_SECRET || env.DISCORD_CLIENT_SECRET || "";
}

export async function assinarSessao(dados, segredo) {
  const corpo = paraBase64Url(codificador.encode(JSON.stringify(dados)));
  const chave = await chaveHmac(segredo);
  const assinatura = new Uint8Array(await crypto.subtle.sign("HMAC", chave, codificador.encode(corpo)));
  return corpo + "." + paraBase64Url(assinatura);
}

export async function lerSessao(request, segredo) {
  if (!segredo) return null;
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)discord_session=([^;]+)/);
  if (!m) return null;
  const [corpo, assinatura] = m[1].split(".");
  if (!corpo || !assinatura) return null;
  try {
    const chave = await chaveHmac(segredo);
    const valido = await crypto.subtle.verify("HMAC", chave, deBase64Url(assinatura), codificador.encode(corpo));
    if (!valido) return null;
    const dados = JSON.parse(decodificador.decode(deBase64Url(corpo)));
    if (!dados.exp || Date.now() > dados.exp) return null;
    return dados;
  } catch {
    return null;
  }
}
