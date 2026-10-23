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

test('o título pula comandos e aceita um nome dado pelo dono', async () => {
  const comClear = [{ id: 'z', ep: 90, origin: 'dono', text: '/clear' }].concat(msgs);
  assert.strictEqual(trechosArquivados(comClear, [200])[0].titulo, 'Oi, monte o relatório de evasão');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arq-'));
  const ac = criarArquivoConversa({ dataDir: dir });
  ac.cortar('ana', 200);
  assert.strictEqual(ac.renomear('ana', 999, 'x'), false);
  assert.strictEqual(ac.renomear('ana', 200, '  Relatório   de evasão '), true);
  let t = trechosArquivados(msgs, ac.cortes('ana'), criarArquivoConversa({ dataDir: dir }).titulos('ana'));
  assert.deepStrictEqual([t[0].titulo, t[0].nomeado], ['Relatório de evasão', true]);
  ac.cortar('ana', 400);
  assert.deepStrictEqual(criarArquivoConversa({ dataDir: dir }).titulos('ana'), { 200: 'Relatório de evasão' });
  ac.renomear('ana', 200, '');
  t = trechosArquivados(msgs, ac.cortes('ana'), ac.titulos('ana'));
  assert.deepStrictEqual([t[1].titulo, t[1].nomeado], ['Oi, monte o relatório de evasão', false]);

  const registro = { estado: () => ({ ok: true, agentes: [{ slug: 'ana', tipo: 'agente' }] }) };
  const comFoto = msgs.concat([{ id: 'g', ep: 120, origin: 'dono', text: 'foto.png', media: { id: 'm1', kind: 'photo', nome: 'foto.png', disponivel: true, url: '/api/v1/media/m1', thumb: '/api/v1/media/m1/thumb', path: '/x' } }]);
  const h = criarHistorico({ registro, log: () => {}, conversa: { thread: async () => ({ msgs: comFoto }) }, arquivoConversa: ac, roda: async () => ({ ok: true, saida: '' }) });
  const { Readable } = require('node:stream');
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ titulo: 'Evasão' }))]), { method: 'PUT' });
  let res = resposta();
  await h.tratar(req, res, new URL('http://x/api/v1/historico/ana/arquivadas/200'), { usuario: 'dono' });
  assert.strictEqual(res.corpo.arquivada.titulo, 'Evasão');
  const foto = res.corpo.msgs.find((m) => m.id === 'g').media;
  assert.deepStrictEqual(foto, { id: 'm1', kind: 'photo', nome: 'foto.png', disponivel: true, url: '/api/v1/media/m1', thumb: '/api/v1/media/m1/thumb' });
  res = resposta();
  await h.tratar({ method: 'PUT' }, res, new URL('http://x/api/v1/historico/ana/memorias'), { usuario: 'dono' });
  assert.strictEqual(res.status, 405);
});
