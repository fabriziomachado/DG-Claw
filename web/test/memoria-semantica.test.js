'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarMemoriaSemantica, barrasDeUso } = require('../lib/memoria-semantica');

test('barras de uso: 32 fatias de 1,5 h nas últimas 48 h, contando o que achou', () => {
  const agora = Date.parse('2026-10-20T21:00:00Z');
  const b = barrasDeUso([
    { ts: '2026-10-20T20:59:00Z', achou: true }, { ts: '2026-10-20T20:30:00Z', achou: false },
    { ts: '2026-10-18T20:00:00Z', achou: true },   // fora da janela
  ], agora);
  assert.equal(b.length, 32);
  assert.deepEqual(b[31], { perguntas: 2, achou: 1 });
  assert.equal(b.reduce((s, x) => s + x.perguntas, 0), 2);
});

test('lembrete: a chave grava e apaga o arquivo na pasta de configuração de cada agente; a caixa recebe 403', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));
  const home = path.join(raiz, 'data', 'home'); fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(path.join(raiz, 'data', 'config'));
  const m = criarMemoriaSemantica({ registro: { estado: () => ({ ok: true, agentes: [{ slug: 'data', nome: 'Data', tipo: 'agente', home_host: home }] }) } });
  const chama = async (metodo, url, corpo, sessao = { via: 'login' }) => {
    const req = require('node:stream').Readable.from(corpo ? [Buffer.from(JSON.stringify(corpo))] : []);
    req.method = metodo; req.headers = { 'content-type': 'application/json' };
    let codigo = 0, saida = '';
    const res = { writeHead(c) { codigo = c; return this; }, setHeader() {}, end(b) { saida = String(b || ''); } };
    await m.rotas(req, res, new URL('http://x' + url), sessao);
    return { codigo, corpo: saida ? JSON.parse(saida) : null };
  };
  assert.equal((await chama('GET', '/api/v1/memoria', null, { via: 'caixa' })).codigo, 403);
  assert.equal((await chama('POST', '/api/v1/memoria/config', { lembrete: false })).corpo.lembrete, false);
  assert.ok(fs.existsSync(path.join(raiz, 'data', 'config', 'memoria-lembrete-desligado')));
  assert.equal((await chama('POST', '/api/v1/memoria/config', { lembrete: true })).corpo.lembrete, true);
  const v = (await chama('GET', '/api/v1/memoria')).corpo;
  assert.equal(v.agentes[0].ligada, false, 'sem índice e sem modelo: desligada');
  assert.equal(v.agentes[0].barras.length, 32);
});
