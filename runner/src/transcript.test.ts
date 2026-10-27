import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pastaTemporaria, prepararAmbiente } from "./apoio-teste.js";

prepararAmbiente("transcript");
const { loginExpiradoNoFimDoTranscript, turnoEncerradoNoTranscript } = await import("./transcript.js");

const config = pastaTemporaria("transcript-config");
const ID = "11111111-2222-3333-4444-555555555555";
const arquivo = path.join(config, "projects", "proj", `${ID}.jsonl`);
fs.mkdirSync(path.dirname(arquivo), { recursive: true });
const ts = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse("2026-10-19T12:00:00Z");

function gravar(linhas: Array<Record<string, unknown>>): void {
  fs.writeFileSync(arquivo, linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
const normal = (ms: number) => ({ type: "assistant", timestamp: ts(ms), message: { role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "feito" }] } });
const pedido = (ms: number) => ({ type: "user", timestamp: ts(ms), message: { role: "user", content: "oi" } });
const sintetica = (ms: number) => ({
  type: "assistant",
  timestamp: ts(ms),
  isApiErrorMessage: true,
  error: "authentication_failed",
  message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "Login expired · Please run /login" }] },
});

test("o erro sintético depois do último turno normal conta como login expirado, com a hora dele", () => {
  gravar([pedido(T0), normal(T0 + 1000), pedido(T0 + 2000), sintetica(T0 + 3000), { type: "system", subtype: "turn_duration", timestamp: ts(T0 + 3500) }]);
  const r = loginExpiradoNoFimDoTranscript(ID, 0, config);
  assert.equal(r.expirado, true);
  assert.equal(r.quando, T0 + 3000);
});

test("se o agente falou depois do erro, o login já voltou: não conta", () => {
  gravar([pedido(T0), sintetica(T0 + 1000), pedido(T0 + 2000), normal(T0 + 3000)]);
  assert.equal(loginExpiradoNoFimDoTranscript(ID, 0, config).expirado, false);
});

test("o erro é mais velho que a credencial atual: não conta (login refeito depois dele)", () => {
  gravar([pedido(T0), sintetica(T0 + 1000)]);
  const r = loginExpiradoNoFimDoTranscript(ID, T0 + 5000, config);
  assert.equal(r.expirado, false);
  assert.match(r.motivo, /anterior à credencial/);
});

test("mensagem sintética que não é de login (outro erro de API) não conta", () => {
  gravar([pedido(T0), { ...sintetica(T0 + 1000), error: "rate_limit", message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "Rate limit reached" }] } }]);
  assert.equal(loginExpiradoNoFimDoTranscript(ID, 0, config).expirado, false);
});

test("sem arquivo ou com linha truncada no fim: não afirma nada, e diz por quê", () => {
  assert.equal(loginExpiradoNoFimDoTranscript("nao-existe", 0, config).expirado, false);
  fs.writeFileSync(arquivo, JSON.stringify(pedido(T0)) + "\n" + JSON.stringify(sintetica(T0 + 1000)) + "\n{\"type\":\"assis");
  assert.equal(loginExpiradoNoFimDoTranscript(ID, 0, config).expirado, true, "a linha cortada no fim é ignorada");
});

test("Esc no meio do turno: a linha de interrupção conta como fim do turno (o Stop não vem)", () => {
  const usoDeFerramenta = { type: "assistant", timestamp: ts(T0 + 1000), message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } };
  const interrompido = (ms: number) => ({ type: "user", timestamp: ts(ms), message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } });
  gravar([pedido(T0), usoDeFerramenta, interrompido(T0 + 2000)]);
  assert.equal(turnoEncerradoNoTranscript(ID, T0, config).encerrado, true);
  // interrupção velha (de antes do turno atual) não encerra o turno novo
  assert.equal(turnoEncerradoNoTranscript(ID, T0 + 5000, config).encerrado, false);
  // pedido comum no fim continua sendo "trabalhando"
  gravar([pedido(T0), usoDeFerramenta, pedido(T0 + 3000)]);
  assert.equal(turnoEncerradoNoTranscript(ID, T0, config).encerrado, false);
});
