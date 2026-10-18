'use strict';
// lib/arquivo-conversa.js: o /clear corta a conversa da tela; o antes vira conversa arquivada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarArquivoConversa, trechosArquivados } = require('../lib/arquivo-conversa');
const { criarHistorico } = require('../lib/historico');

const msgs = [
  { id: 'a', ep: 100, origin: 'dono', text: 'Oi, monte o relatório de evasão' },
  { id: 'b', ep: 110, origin: 'agente', text: '[ENTREGA] Pronto, **relatório** feito' },
  { id: 'c', ep: 300, origin: 'dono', text: 'Agora outra coisa' },
  { id: 'd', ep: 310, origin: 'agente', text: 'Certo' },
  { id: 'e', ep: 500, origin: 'dono', text: 'Conversa de agora' },
];

test('trechos entre os cortes, o mais novo primeiro, com título e prévia limpos', () => {
  const t = trechosArquivados(msgs, [200, 400]);
  assert.deepStrictEqual(t.map((x) => [x.id, x.de, x.ate, x.total]), [[400, 300, 310, 2], [200, 100, 110, 2]]);
  assert.strictEqual(t[1].titulo, 'Oi, monte o relatório de evasão');
  assert.strictEqual(t[1].previa, 'Pronto, relatório feito');
  assert.deepStrictEqual(trechosArquivados(msgs, [50]), []);
});

test('a tela vê só depois do último corte, e o corte fica gravado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arq-'));
  const ac = criarArquivoConversa({ dataDir: dir });
  const t = { msgs, avisos: [] };
  assert.strictEqual(ac.visivel('ana', t), t);
  assert.strictEqual(ac.cortar('ana', 400), true);
  assert.strictEqual(ac.cortar('ana', 350), false);
  const v = ac.visivel('ana', t);
  assert.deepStrictEqual(v.msgs.map((m) => m.id), ['e']);
  assert.strictEqual(ac.visivel('ana', t).msgs, v.msgs);
  const eco = { msgs: msgs.concat([{ id: 'f', ep: 401, origin: 'dono', text: '/clear' }]), avisos: [] };
  assert.deepStrictEqual(ac.visivel('ana', eco).msgs.map((m) => m.id), ['e']);
  assert.deepStrictEqual(criarArquivoConversa({ dataDir: dir }).cortes('ana'), [400]);
  assert.strictEqual((fs.statSync(path.join(dir, 'arquivo', 'ana.json')).mode & 0o777), 0o600);
});

function resposta() {
  const r = { status: 0, corpo: null };
  r.writeHead = (st) => { r.status = st; };
  r.end = (txt) => { r.corpo = JSON.parse(txt); };
  return r;
}

test('o histórico lista e abre as conversas arquivadas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arq-'));
  const ac = criarArquivoConversa({ dataDir: dir });
  ac.cortar('ana', 200); ac.cortar('ana', 400);
  const registro = { estado: () => ({ ok: true, agentes: [{ slug: 'ana', tipo: 'agente' }] }) };
  const h = criarHistorico({ registro, log: () => {}, conversa: { thread: async () => ({ msgs }) }, arquivoConversa: ac, roda: async () => ({ ok: true, saida: '' }) });
  let res = resposta();
  await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/ana/arquivadas'), { usuario: 'dono' });
  assert.deepStrictEqual(res.corpo.arquivadas.map((x) => x.id), [400, 200]);
  res = resposta();
  await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/ana/arquivadas/200'), { usuario: 'dono' });
  assert.deepStrictEqual(res.corpo.msgs.map((m) => m.id), ['a', 'b']);
  res = resposta();
  await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/ana/arquivadas/999'), { usuario: 'dono' });
  assert.strictEqual(res.status, 404);
  res = resposta();
  await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/ana/busca/1'), { usuario: 'dono' });
  assert.strictEqual(res.status, 404);
});
