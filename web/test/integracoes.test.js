'use strict';
// lib/integracoes.js: leitura do `claude mcp list` e a porta fechada para a caixa dos agentes.
const test = require('node:test');
const assert = require('node:assert');
const { criarIntegracoes, linhaMcp } = require('../lib/integracoes');

test('linhas do claude mcp list viram conector com origem e estado', () => {
  const g = linhaMcp('claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected');
  assert.deepStrictEqual([g.nome, g.origem, g.estado, g.endereco], ['Gmail', 'conta', 'conectado', 'https://gmailmcp.googleapis.com/mcp/v1']);
  const s = linhaMcp('plugin:engineering:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication');
  assert.deepStrictEqual([s.nome, s.origem, s.plugin, s.estado, s.endereco], ['slack', 'plugin', 'engineering', 'precisa_entrar', 'https://mcp.slack.com/mcp']);
  const t = linhaMcp('plugin:telegram:telegram: bun run --cwd /x start - ✘ Failed to connect — CONNECTION_CLOSED');
  assert.strictEqual(t.estado, 'falha');
  assert.strictEqual(t.endereco, '');
  assert.strictEqual(linhaMcp('fabriciq: https://api.fabric.microsoft.com/v1/mcp/fabriciq (HTTP) - ✔ Connected').origem, 'manual');
  assert.strictEqual(linhaMcp('Checking MCP server health…'), null);
});

function resposta() {
  const r = { status: 0, corpo: null };
  r.writeHead = (st) => { r.status = st; };
  r.end = (txt) => { r.corpo = JSON.parse(txt); };
  return r;
}
const registro = { estado: () => ({ ok: true, agentes: [{ slug: 'admin', nome: 'Admin', tipo: 'admin' }, { slug: 'ana', nome: 'Ana', tipo: 'agente' }] }) };

test('a caixa de um agente não alcança as integrações', async () => {
  const ig = criarIntegracoes({ registro, log: () => {} });
  const res = resposta();
  assert.strictEqual(await ig.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/integracoes'), { via: 'caixa', agente: 'ana' }), true);
  assert.strictEqual(res.status, 403);
});

test('o Admin não é mudado pela tela', async () => {
  const ig = criarIntegracoes({ registro, log: () => {} });
  const res = resposta();
  await ig.tratar({ method: 'POST' }, res, new URL('http://x/api/v1/integracoes/admin/reiniciar'), { usuario: 'dono' });
  assert.strictEqual(res.status, 403);
});

test('rota de outra coisa não é tratada aqui', async () => {
  const ig = criarIntegracoes({ registro, log: () => {} });
  assert.strictEqual(await ig.tratar({ method: 'GET' }, resposta(), new URL('http://x/api/v1/avisos'), { usuario: 'dono' }), false);
});
