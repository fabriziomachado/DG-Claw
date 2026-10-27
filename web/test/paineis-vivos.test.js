'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPaineisVivos } = require('../lib/paineis-vivos');

function cenario(respostas) {
  const chamadas = [];
  const registro = { estado: () => ({ ok: true, agentes: [{ slug: 'admin', tipo: 'admin' }, { slug: 'ana', container: 'dgclaw-ana' }] }) };
  const roda = async (cmd, args) => { chamadas.push([cmd, ...args]); return respostas.shift() || { ok: false, codigo: 1, saida: '' }; };
  let t = 1000000;
  const pv = criarPaineisVivos({ registro, roda, agora: () => t });
  const res = () => { const r = { status: 0, corpo: null, writeHead(s) { r.status = s; }, end(b) { r.corpo = JSON.parse(b); } }; return r; };
  const pede = async (m, caminho, sessao = { usuario: 'dono' }) => { const r = res(); const ok = await pv.tratar({ method: m, resume() {} }, r, new URL('http://x' + caminho), sessao); return { ok, ...r }; };
  return { pede, chamadas, avanca: (ms) => { t += ms; } };
}

test('paineis vivos: lê pela caixa, atualiza rodando o script como agente, recusa caixa e id ruim', async () => {
  const s = cenario([
    { ok: true, saida: '1792000000\n{"tipo":"kpi","valor":"9"}' },
    { ok: true, saida: '' }, { ok: true, saida: '1792000100\n{"tipo":"kpi","valor":"10"}' },
    { ok: false, codigo: 3, saida: '' },
  ]);
  const g = await s.pede('GET', '/api/v1/paineis/ana/chamados');
  assert.equal(g.status, 200); assert.equal(g.corpo.painel.valor, '9'); assert.equal(g.corpo.atualizado, 1792000000000);
  assert.deepEqual(s.chamadas[0].slice(0, 7), ['podman', 'exec', '-u', 'agente', '-w', '/home/agente', 'dgclaw-ana']);
  assert.equal(s.chamadas[0].at(-1), '/home/agente/.dgclaw/paineis/chamados.json', 'o caminho vai como argumento');
  const a = await s.pede('POST', '/api/v1/paineis/ana/chamados/atualizar');
  assert.equal(a.status, 200); assert.equal(a.corpo.painel.valor, '10');
  const seguido = await s.pede('POST', '/api/v1/paineis/ana/chamados/atualizar');
  assert.equal(seguido.status, 200, 'dentro de 30 s não roda de novo'); assert.equal(s.chamadas.length, 4);
  s.avanca(31000);
  const sem = await s.pede('POST', '/api/v1/paineis/ana/outro/atualizar');
  assert.equal(sem.status, 409); assert.match(sem.corpo.erro, /script/);
  assert.equal((await s.pede('GET', '/api/v1/paineis/ana/chamados', { via: 'caixa', agente: 'ana' })).status, 403);
  assert.equal((await s.pede('GET', '/api/v1/paineis/ana/..%2Fetc')).status, 404);
  assert.equal((await s.pede('GET', '/api/v1/paineis/admin/x')).status, 404);
});

test('paineis vivos: o script recebe as chaves do cofre pelo ambiente, nunca na linha de comando', async () => {
  const chamadas = [];
  const registro = { estado: () => ({ ok: true, agentes: [{ slug: 'ana', container: 'dgclaw-ana', cofre_arquivo: '/x/cofre.env' }] }) };
  const roda = async (cmd, args, op) => { chamadas.push({ args, env: op && op.env }); return { ok: true, saida: '1\n{}' }; };
  const pv = criarPaineisVivos({ registro, roda, chavesDe: () => ({ DOKPLOY_API_KEY: 'segredo-123', 'nome ruim': 'x' }) });
  const r = { writeHead() {}, end() {} };
  await pv.tratar({ method: 'POST', resume() {} }, r, new URL('http://x/api/v1/paineis/ana/dokploy/atualizar'), { usuario: 'dono' });
  const c = chamadas[0];
  assert.ok(c.args.includes('-e') && c.args[c.args.indexOf('-e') + 1] === 'DOKPLOY_API_KEY');
  assert.ok(!c.args.join(' ').includes('segredo-123'), 'o valor não vai nos argumentos');
  assert.ok(!c.args.includes('nome ruim'));
  assert.equal(c.env.DOKPLOY_API_KEY, 'segredo-123');
});
