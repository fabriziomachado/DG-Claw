'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarAvatares } = require('../lib/avatar');

test('avatar dormindo: só vale com o "dormindo"; a rota serve cada pedaço e recusa a caixa', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sono-'));
  fs.mkdirSync(path.join(dir, 'avatares'));
  const av = criarAvatares({ dataDir: dir, registro: { obter: s => (s === 'tech' ? { slug: 'tech' } : null) }, log() {} });
  fs.writeFileSync(path.join(dir, 'avatares', 'tech-adormecendo.webp'), 'a');
  assert.equal(av.sono('tech'), null, 'sem o dormindo não há animação');
  fs.writeFileSync(path.join(dir, 'avatares', 'tech-dormindo.webp'), 'RIFFxxxxWEBP');
  const s = av.sono('tech');
  assert.match(s.dormindo, /^\/api\/v1\/agents\/tech\/avatar\/dormindo\?v=/);
  assert.match(s.adormecendo, /\/avatar\/adormecendo\?v=/);
  assert.equal(s.parado, undefined);
  const chama = async (url, sessao) => {
    let codigo = 0, tipo = '';
    const res = { writeHead(c, h) { codigo = c; tipo = (h || {})['Content-Type'] || ''; return this; }, setHeader() {}, end() {}, on() { return this; }, once() { return this; }, emit() {}, write() { return true; } };
    const ok = { enviaJson: (r, c) => { codigo = c; }, erroJson: (r, c) => { codigo = c; } };
    await av.tratar({ method: 'GET' }, res, new URL('http://x' + url), sessao, ok);
    return { codigo, tipo };
  };
  assert.equal((await chama('/api/v1/agents/tech/avatar/dormindo', { via: 'caixa' })).codigo, 403);
  assert.equal((await chama('/api/v1/agents/nada/avatar/dormindo', { via: 'login' })).codigo, 404);
  assert.equal((await chama('/api/v1/agents/tech/avatar/parado', { via: 'login' })).codigo, 404);
});

test('sono.js carrega em todas as telas com a fileira e o sw guarda', () => {
  const pub = (n) => fs.readFileSync(path.join(__dirname, '../public', n), 'utf8');
  for (const h of ['conversa.html', 'saude.html', 'caixa.html', 'mesa.html']) assert.match(pub(h), /<script src="\/sono\.js" defer><\/script>/, h);
  assert.match(pub('sw.js'), /'\/sono\.js'/);
  assert.match(pub('sono.js'), /SONO_MIN = 10/);
});
