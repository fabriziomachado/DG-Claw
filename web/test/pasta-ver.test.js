'use strict';
// Pasta do agente com a cara da conversa (25/10/2026): só abre o que está dentro de <casa>/arquivos.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { arquivoDaPasta } = require('../lib/pasta-ver');
const { subirWeb } = require('./ajuda');

function casa() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'pasta-'));
  fs.mkdirSync(path.join(h, 'arquivos', 'radar'), { recursive: true });
  fs.writeFileSync(path.join(h, 'arquivos', 'radar', 'relatorio.md'), '# Radar\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  fs.writeFileSync(path.join(h, 'segredo.env'), 'CHAVE=x');
  fs.mkdirSync(path.join(h, '.dgclaw'));
  fs.writeFileSync(path.join(h, 'arquivos', '.escondido'), 'x');
  fs.symlinkSync(path.join(h, 'segredo.env'), path.join(h, 'arquivos', 'atalho.env'));
  return h;
}

test('arquivoDaPasta abre só o que está dentro da Pasta, com o atalho já seguido', () => {
  const h = casa();
  const ok = arquivoDaPasta(h, 'radar/relatorio.md');
  assert.strictEqual(ok.real, fs.realpathSync(path.join(h, 'arquivos', 'radar', 'relatorio.md')));
  assert.strictEqual(ok.nome, 'relatorio.md');
  assert.strictEqual(arquivoDaPasta(h, '../segredo.env').status, 400);
  assert.strictEqual(arquivoDaPasta(h, 'radar/../../segredo.env').status, 400);
  assert.strictEqual(arquivoDaPasta(h, '.escondido').status, 400);
  assert.strictEqual(arquivoDaPasta(h, 'atalho.env').status, 403, 'atalho para fora da Pasta');
  assert.strictEqual(arquivoDaPasta(h, 'radar').status, 400, 'pasta não é arquivo');
  assert.strictEqual(arquivoDaPasta(h, 'nao-existe.md').status, 404);
  assert.strictEqual(arquivoDaPasta(h, '').status, 400);
  assert.strictEqual(arquivoDaPasta(null, 'x.md').status, 503);
});

test('GET /api/v1/agents/<slug>/pasta/abrir devolve a mídia para o dono e a tela /ver-arquivo pede login', async () => {
  const h = casa();
  const s = await subirWeb({ agentes: [{ slug: 'tech', nome: 'Tech', tipo: 'trabalho', runner: 'http://127.0.0.1:1', agente_id: 't1', home_host: h, home_container: '/home/agente' }] });
  try {
    const semLogin = await s.c.get('/ver-arquivo?agente=tech&caminho=radar/relatorio.md');
    assert.notStrictEqual(semLogin.status, 200);
    await s.login();
    const r = await s.c.get('/api/v1/agents/tech/pasta/abrir?caminho=' + encodeURIComponent('radar/relatorio.md'));
    assert.strictEqual(r.status, 200, r.texto);
    assert.match(r.json.media.url, /^\/api\/v1\/media\//);
    const arq = await s.c.get(r.json.media.url);
    assert.strictEqual(arq.status, 200);
    assert.match(arq.texto, /# Radar/);
    const fora = await s.c.get('/api/v1/agents/tech/pasta/abrir?caminho=atalho.env');
    assert.strictEqual(fora.status, 403);
  } finally { await s.fechar(); }
});

test('imagem da Pasta: serve JPG/PNG com nosniff; texto e atalho para fora são recusados', async () => {
  const h = casa();
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(30, 1)]);
  fs.writeFileSync(path.join(h, 'arquivos', 'radar', 'foto.png'), png);
  const s = await subirWeb({ agentes: [{ slug: 'tech', nome: 'Tech', tipo: 'trabalho', runner: 'http://127.0.0.1:1', agente_id: 't1', home_host: h, home_container: '/home/agente' }] });
  try {
    await s.login();
    const r = await s.c.get('/api/v1/agents/tech/pasta/imagem?caminho=radar/foto.png');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['content-type'], 'image/png');
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(png.equals(r.buf));
    assert.strictEqual((await s.c.get('/api/v1/agents/tech/pasta/imagem?caminho=radar/relatorio.md')).status, 415);
    assert.strictEqual((await s.c.get('/api/v1/agents/tech/pasta/imagem?caminho=atalho.env')).status, 403);
  } finally { await s.fechar(); }
});
