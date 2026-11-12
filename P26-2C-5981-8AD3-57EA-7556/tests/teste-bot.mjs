import assert from "node:assert/strict";
globalThis.Response = globalThis.Response || class {};
Response.json = (b, o) => ({ body: b, status: o?.status });
const { frotaAleatoria, escolherAlvoBot, FROTA, BOT_ID } = await import("../src/batalha.js");
assert.equal(BOT_ID, "bot");
for (let i = 0; i < 300; i++) {
  const f = frotaAleatoria();
  assert.deepEqual(f.map((n) => n.tamanho).sort((a, b) => a - b), [...FROTA].sort((a, b) => a - b));
  const todas = f.flatMap((n) => n.celulas);
  assert.equal(new Set(todas).size, 17, "sem sobreposição");
  assert.ok(todas.every((k) => k >= 0 && k < 100), "dentro da malha");
  for (const n of f) {
    const passo = n.celulas[1] - n.celulas[0];
    assert.ok(passo === 1 || passo === 10, "navio em linha reta");
    n.celulas.forEach((k, i) => { if (i) assert.equal(k - n.celulas[i - 1], passo); });
  }
}
const tiradas = new Set([0, 1, 2]);
const hist = [{ linha: 5, coluna: 5, resultado: "acerto" }];
for (let i = 0; i < 200; i++) {
  const a = escolherAlvoBot(tiradas, hist);
  assert.ok(!tiradas.has(a));
  assert.ok([[4,5],[6,5],[5,4],[5,6]].map(([l,c])=>l*10+c).includes(a), "prioriza vizinhos do acerto");
}
const sem = escolherAlvoBot(new Set(), []);
assert.ok(sem >= 0 && sem < 100);
console.log("testes do bot passaram");
