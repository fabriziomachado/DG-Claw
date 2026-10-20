'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../lib/saude-servidor');
const M = require('../public/menu-lado');

test('lerStatus entende as três marcas do dgclaw status', () => {
  const linhas = S.lerStatus('DG Claw\n  ok     servico caddy de pe\n  aviso  disco em 80%\n  FALHOU agente help: sem resposta\nfim');
  assert.deepEqual(linhas, [
    { estado: 'ok', texto: 'servico caddy de pe' },
    { estado: 'aviso', texto: 'disco em 80%' },
    { estado: 'falha', texto: 'agente help: sem resposta' },
  ]);
});

test('tokensDe soma cada resposta uma vez só, mesmo repetida no registro', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
  const dir = path.join(home, '.claude/projects/x');
  fs.mkdirSync(dir, { recursive: true });
  const u = { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5, output_tokens: 7 };
  const l = id => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id, usage: u } });
  fs.writeFileSync(path.join(dir, 's.jsonl'), [l('m1'), l('m1'), l('m2')].join('\n') + '\n');
  assert.deepEqual(S.tokensDe(home, Date.now() - 3600000), { entrada: 230, cache: 200, saida: 14 });
});

test('a rota recusa quem chega pela caixa de um agente', async () => {
  const s = S.criarSaudeServidor({ registro: { estado: () => ({ agentes: [] }) }, conversa: {}, log() {} });
  let codigo = 0;
  const res = { writeHead(c) { codigo = c; return this; }, setHeader() {}, end() {} };
  const r = await s.rotas({ method: 'GET' }, res, new URL('http://x/api/v1/saude-servidor'), { via: 'caixa' });
  assert.equal(r, true);
  assert.equal(codigo, 403);
});

test('menu: a Saúde do servidor fica no grupo Saúde e só o Admin ganha o item', () => {
  assert.equal(M.chaveDoHref('/saude'), 'saude-servidor');
  assert.equal(M.grupoDe('saude-servidor'), 'saude');
  const js = fs.readFileSync(path.join(__dirname, '../public/menu-lado.js'), 'utf8');
  assert.match(js, /if \(ag\.tipo === 'admin'\) \{\s*\$\('mlTabs'\)[^]*?LINK_SAUDE_SERVIDOR/);
});

test('saude.html carrega a página e o sw guarda os arquivos', () => {
  const h = fs.readFileSync(path.join(__dirname, '../public/saude.html'), 'utf8');
  assert.match(h, /\/saude\.js/);
  assert.match(h, /pagina: 'saude-servidor'/);
  const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  assert.match(sw, /'\/saude\.js', '\/saude\.css'/);
});
