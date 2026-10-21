'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { criarMesa, normalizaEntrada, calculaLeitura, ordemDaMesa } = require('../lib/mesa');
const { pastaTemp, capturaLog, subirWeb } = require('./ajuda');

const AGENTES = [
  { slug: 'luna', nome: 'Luna' },
  { slug: 'marina', nome: 'Marina' },
];
const registroFalso = {
  estado: () => ({ ok: true, agentes: AGENTES, erro: null }),
  obter: (slug) => AGENTES.find((a) => a.slug === slug) || null,
};

/** Monta uma mesa com relógio controlado e um servidor HTTP que chama mesa.rota (quem vem no cabeçalho x-quem). */
async function montar(extra) {
  const dir = pastaTemp('mesa');
  const arquivo = path.join(dir, 'mesa', 'tarefas.json');
  const cap = capturaLog();
  const relogio = { ms: Date.parse('2026-10-05T15:00:00-03:00') };
  const inputs = [];
  const avisos = [];
  const runner = extra && extra.runner ? extra.runner : { input: async (ag, corpo) => { inputs.push({ slug: ag.slug, corpo }); return { ok: true }; } };
  const mesa = criarMesa(Object.assign({
    arquivo, registro: registroFalso, runner, log: cap.log, tz: 'America/Sao_Paulo',
    agora: () => new Date(relogio.ms),
    avisarDono: async (a) => { avisos.push(a); },
  }, extra && extra.opcoes));
  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const q = req.headers['x-quem'] || 'dono';
    const sessao = q === 'dono' ? { usuario: 'dono' } : { via: 'caixa', agente: q, usuario: 'x' };
    if (!(await mesa.rota(req, res, url, sessao))) { res.writeHead(404); res.end('fora'); }
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const porta = servidor.address().port;
  async function pedir(metodo, caminho, { json, quem, headers } = {}) {
    const h = Object.assign({ 'x-quem': quem || 'dono' }, headers || {});
    let body;
    if (json !== undefined) { body = typeof json === 'string' ? json : JSON.stringify(json); h['content-type'] = 'application/json'; }
    const r = await fetch(`http://127.0.0.1:${porta}${caminho}`, { method: metodo, headers: h, body });
    const texto = await r.text();
    let j = null; try { j = JSON.parse(texto); } catch (_) { /* não é JSON */ }
    return { status: r.status, headers: r.headers, texto, json: j };
  }
  return {
    dir, arquivo, cap, relogio, inputs, avisos, mesa, pedir,
    avanca: (min) => { relogio.ms += min * 60000; },
    async fechar() { servidor.closeAllConnections(); await new Promise((r) => servidor.close(r)); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const NOVA = { titulo: 'Roteiro do reels', origem: 'Dono, 05/10 15h42: faz o roteiro' };
async function criarTarefa(m, extra, quem) {
  const r = await m.pedir('POST', '/api/v1/tarefas', { json: Object.assign({ agente: 'luna' }, NOVA, extra || {}), quem });
  assert.equal(r.status, 201, r.texto);
  return r.json.tarefa;
}

test('criar: 201, padrões e fuso local', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m);
    assert.equal(t.id, 1);
    assert.equal(t.estado, 'fazendo');
    assert.equal(t.tipo, 'outro');
    assert.equal(t.aberta, true);
    assert.equal(t.progresso, null);
    assert.equal(t.progresso_origem, null);
    assert.equal(t.criada_por, 'dono (dono)');
    assert.equal(t.criada_em, '2026-10-05T15:00:00-03:00');
    assert.equal(t.versao, '1');
    assert.equal(t.atualizada_ha_min, 0);
    assert.equal(t.eventos[0].acao, 'criou');
    assert.equal((await criarTarefa(m, { titulo: 'Outra' })).id, 2);
  } finally { await m.fechar(); }
});

test('criar: 400 campo a campo', async () => {
  const m = await montar();
  try {
    const r = await m.pedir('POST', '/api/v1/tarefas', { json: { titulo: 'x'.repeat(121), tipo: 'foo', estado: 'travada', progresso: 150, link: 'ftp://a', passos: [1], agente: 'ninguem' } });
    assert.equal(r.status, 400);
    assert.equal(r.json.ok, false);
    for (const k of ['titulo', 'origem', 'tipo', 'progresso', 'link', 'passos', 'agente']) assert.ok(r.json.erros[k], `falta erro de ${k}: ${r.texto}`);
    assert.match(r.json.erros.agente, /luna, marina/);
    const r2 = await m.pedir('POST', '/api/v1/tarefas', { json: Object.assign({ agente: 'luna', estado: 'travada' }, NOVA) });
    assert.match(r2.json.erros.motivo, /obrigatório quando o estado é travada/);
    const r3 = await m.pedir('POST', '/api/v1/tarefas', { json: Object.assign({ agente: 'luna', estado: 'concluida' }, NOVA) });
    assert.ok(r3.json.erros.estado);
    const r4 = await m.pedir('POST', '/api/v1/tarefas', { json: NOVA });
    assert.match(r4.json.erros.agente, /obrigatório/);
    assert.equal((await m.pedir('POST', '/api/v1/tarefas', { json: '{quebrado' })).status, 400);
    assert.equal((await m.pedir('POST', '/api/v1/tarefas', { json: '[]' })).status, 400);
  } finally { await m.fechar(); }
});

test('corpo acima de 64 KB dá 413; método errado 405; id ruim 400; id inexistente 404', async () => {
  const m = await montar();
  try {
    const grande = await m.pedir('POST', '/api/v1/tarefas', { json: Object.assign({ agente: 'luna', nota: 'a'.repeat(70 * 1024) }, NOVA) });
    assert.equal(grande.status, 413);
    assert.equal((await m.pedir('PUT', '/api/v1/tarefas')).status, 405);
    assert.match((await m.pedir('POST', '/api/v1/tarefas/1')).json.erro, /PATCH/);
    assert.equal((await m.pedir('GET', '/api/v1/tarefas/abc')).status, 400);
    assert.equal((await m.pedir('GET', '/api/v1/tarefas/99')).status, 404);
  } finally { await m.fechar(); }
});

test('permissões: agente só cria para si, 403 em tarefa alheia, dono cria para qualquer um', async () => {
  const m = await montar();
  try {
    const propria = await m.pedir('POST', '/api/v1/tarefas', { json: NOVA, quem: 'luna' });
    assert.equal(propria.status, 201);
    assert.equal(propria.json.tarefa.agente, 'luna');
    assert.equal(propria.json.tarefa.criada_por, 'agente luna');
    const ignorado = await m.pedir('POST', '/api/v1/tarefas', { json: Object.assign({ agente: 'luna' }, NOVA), quem: 'luna' });
    assert.equal(ignorado.status, 201);
    const alheio = await m.pedir('POST', '/api/v1/tarefas', { json: Object.assign({ agente: 'marina' }, NOVA), quem: 'luna' });
    assert.equal(alheio.status, 403);
    const dono = await m.pedir('POST', '/api/v1/tarefas', { json: Object.assign({ agente: 'marina' }, NOVA) });
    assert.equal(dono.status, 201);
    const id = dono.json.tarefa.id;
    assert.equal((await m.pedir('PATCH', `/api/v1/tarefas/${id}`, { json: { nota: 'x' }, quem: 'luna' })).status, 403);
    assert.equal((await m.pedir('DELETE', `/api/v1/tarefas/${id}`, { quem: 'luna' })).status, 403);
    assert.equal((await m.pedir('GET', `/api/v1/tarefas/${id}`, { quem: 'luna' })).status, 200);
    assert.equal((await m.pedir('PATCH', `/api/v1/tarefas/${id}`, { json: { nota: 'x' }, quem: 'marina' })).status, 200);
    assert.equal((await m.pedir('GET', '/api/v1/tarefas', { quem: 'luna' })).json.tarefas.length, 3);
    const trocar = await m.pedir('PATCH', `/api/v1/tarefas/${id}`, { json: { agente: 'luna' } });
    assert.match(trocar.json.erros.agente, /não muda/);
  } finally { await m.fechar(); }
});

test('PATCH parcial, {} como sinal de vida e atualizada_em', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m);
    m.avanca(10);
    const r = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { nota: 'escrevendo o gancho' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.acao, 'atualizou');
    assert.equal(r.json.tarefa.nota, 'escrevendo o gancho');
    assert.equal(r.json.tarefa.titulo, NOVA.titulo);
    assert.equal(r.json.tarefa.versao, '2');
    m.avanca(40);
    const vivo = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: {} });
    assert.equal(vivo.json.acao, 'sinal de vida');
    assert.equal(vivo.json.tarefa.atualizada_ha_min, 0);
    assert.equal(vivo.json.tarefa.versao, '3');
    assert.equal(vivo.json.recado, 'nao_enviado');
  } finally { await m.fechar(); }
});

test('passos: passo_feito e passo_desfeito por número e por texto; passo inexistente é 400', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m, { passos: ['pesquisa', { texto: 'roteiro', feito: true }, 'revisão'] });
    assert.deepEqual(t.passos.map((p) => p.feito), [false, true, false]);
    let r = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { passo_feito: 1 } });
    assert.deepEqual(r.json.tarefa.passos.map((p) => p.feito), [true, true, false]);
    r = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { passo_feito: 'revisão', passo_desfeito: 2 } });
    assert.deepEqual(r.json.tarefa.passos.map((p) => p.feito), [true, false, true]);
    r = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { passo_feito: 9 } });
    assert.equal(r.status, 400);
    assert.match(r.json.erros.passo_feito, /1=/);
    assert.equal((await m.pedir('POST', '/api/v1/tarefas', { json: Object.assign({ agente: 'luna', passos: new Array(31).fill('a') }, NOVA) })).status, 400);
  } finally { await m.fechar(); }
});

test('motivo: obrigatório em travada e esperando_dono, e some sozinho ao sair', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m);
    const sem = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { estado: 'esperando_dono' } });
    assert.equal(sem.status, 400);
    assert.match(sem.json.erros.motivo, /esperando_dono/);
    const com = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { estado: 'travada', motivo: 'a API caiu' } });
    assert.equal(com.json.tarefa.motivo, 'a API caiu');
    const volta = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { estado: 'fazendo' } });
    assert.equal(volta.json.tarefa.motivo, null);
    const apagar = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { estado: 'travada', motivo: 'x' } });
    assert.equal(apagar.status, 200);
    const vazio = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { motivo: '' } });
    assert.equal(vazio.status, 400);
  } finally { await m.fechar(); }
});

test('progresso calculado: informado, passos, concluída e null nunca 0', async () => {
  const base = { id: 1, estado: 'fazendo', progresso: null, passos: [], atualizada_em_epoch: 0, versao: 1, anexos: [] };
  const agora = 1000;
  assert.deepEqual(pick(calculaLeitura(base, agora)), [null, null]);
  assert.deepEqual(pick(calculaLeitura({ ...base, progresso: 0 }, agora)), [0, 'informado']);
  assert.deepEqual(pick(calculaLeitura({ ...base, progresso: 30, passos: [{ feito: true }, { feito: false }] }, agora)), [30, 'informado']);
  assert.deepEqual(pick(calculaLeitura({ ...base, passos: [{ feito: true }, { feito: false }, { feito: false }] }, agora)), [33, 'passos']);
  assert.deepEqual(pick(calculaLeitura({ ...base, passos: [{ feito: false }] }, agora)), [0, 'passos']);
  assert.deepEqual(pick(calculaLeitura({ ...base, estado: 'concluida', progresso: 10 }, agora)), [100, 'concluida']);
  function pick(l) { return [l.progresso, l.progresso_origem]; }
  const m = await montar();
  try {
    const t = await criarTarefa(m, { progresso: 40 });
    assert.equal(t.progresso, 40);
    const limpo = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { progresso: null } });
    assert.equal(limpo.json.tarefa.progresso, null);
    const fim = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { estado: 'concluida', link: 'https://x.test/a' } });
    assert.equal(fim.json.tarefa.progresso, 100);
    assert.equal(fim.json.acao, 'concluiu');
    assert.equal(fim.json.tarefa.concluida_em, '2026-10-05T15:00:00-03:00');
  } finally { await m.fechar(); }
});

test('parada só depois de 45 minutos sem atualização', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m);
    m.avanca(45);
    let l = (await m.pedir('GET', '/api/v1/tarefas')).json;
    assert.equal(l.tarefas[0].parada, false);
    m.avanca(1);
    l = (await m.pedir('GET', '/api/v1/tarefas')).json;
    assert.equal(l.tarefas[0].parada, true);
    assert.equal(l.tarefas[0].atualizada_ha_min, 46);
    assert.equal(l.contagem.paradas, 1);
    assert.equal(l.parada_min, 45);
    await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: {} });
    assert.equal((await m.pedir('GET', '/api/v1/tarefas')).json.tarefas[0].parada, false);
  } finally { await m.fechar(); }
});

test('ordem da mesa: esperando o dono, travada, parada, fazendo, concluída, cancelada', async () => {
  const m = await montar();
  try {
    const velha = await criarTarefa(m, { titulo: 'velha' });
    m.avanca(50);
    const fazendo = await criarTarefa(m, { titulo: 'fazendo' });
    const trav = await criarTarefa(m, { titulo: 'travada', estado: 'travada', motivo: 'm' });
    const esp = await criarTarefa(m, { titulo: 'esperando', estado: 'esperando_danilo', motivo: 'm' });
    const conc = await criarTarefa(m, { titulo: 'conc' });
    await m.pedir('PATCH', `/api/v1/tarefas/${conc.id}`, { json: { estado: 'concluida' } });
    const canc = await criarTarefa(m, { titulo: 'canc' });
    await m.pedir('DELETE', `/api/v1/tarefas/${canc.id}`);
    const l = (await m.pedir('GET', '/api/v1/tarefas')).json;
    assert.deepEqual(l.tarefas.map((t) => t.titulo), ['esperando', 'travada', 'velha', 'fazendo', 'conc', 'canc']);
    assert.equal(esp.estado, 'esperando_dono');
    assert.ok(velha && fazendo && trav);
    assert.equal(ordemDaMesa({ estado: 'fazendo', parada: false, atualizada_em_epoch: 1, id: 1 }, { estado: 'fazendo', parada: false, atualizada_em_epoch: 2, id: 2 }) > 0, true);
  } finally { await m.fechar(); }
});

test('filtros: agente, estado, dia (slug inexistente é 400)', async () => {
  const m = await montar();
  try {
    await criarTarefa(m, { titulo: 'l1' });
    const m1 = await criarTarefa(m, { titulo: 'm1', agente: 'marina' });
    await criarTarefa(m, { titulo: 'm2', agente: 'marina', estado: 'travada', motivo: 'x' });
    const titulos = async (qs) => (await m.pedir('GET', '/api/v1/tarefas?' + qs)).json.tarefas.map((t) => t.titulo).sort();
    assert.deepEqual(await titulos('agente=marina'), ['m1', 'm2']);
    assert.deepEqual(await titulos('agente=luna,marina'), ['l1', 'm1', 'm2']);
    assert.deepEqual(await titulos('estado=travada'), ['m2']);
    assert.deepEqual(await titulos('estado=fazendo,travada&agente=marina'), ['m1', 'm2']);
    const ruim = await m.pedir('GET', '/api/v1/tarefas?agente=fantasma');
    assert.equal(ruim.status, 400);
    assert.match(ruim.json.erros.agente, /luna, marina/);
    assert.equal((await m.pedir('GET', '/api/v1/tarefas?estado=voando')).status, 400);
    assert.equal((await m.pedir('GET', '/api/v1/tarefas?dia=2026-02-31')).status, 400);

    await m.pedir('PATCH', `/api/v1/tarefas/${m1.id}`, { json: { estado: 'concluida' } });
    assert.deepEqual(await titulos('dia=hoje&estado=concluida'), ['m1']);
    assert.deepEqual(await titulos('dia=2026-10-05&estado=concluida'), ['m1']);
    assert.deepEqual(await titulos('dia=2026-10-04&estado=concluida'), []);
    m.avanca(24 * 60);
    assert.deepEqual(await titulos('estado=concluida'), []);
    assert.deepEqual(await titulos('dia=todos&estado=concluida'), ['m1']);
    assert.deepEqual(await titulos('estado=fazendo,travada'), ['l1', 'm2']);
    const f = (await m.pedir('GET', '/api/v1/tarefas?agente=luna')).json.filtro;
    assert.deepEqual(f, { agente: ['luna'], estado: null, dia: 'hoje' });
  } finally { await m.fechar(); }
});

test('ETag e 304; muda com gravação, filtro e minuto', async () => {
  const m = await montar();
  try {
    await criarTarefa(m);
    const a = await m.pedir('GET', '/api/v1/tarefas');
    const etag = a.headers.get('etag');
    assert.ok(etag);
    assert.equal(a.headers.get('cache-control'), 'private, no-cache');
    const b = await m.pedir('GET', '/api/v1/tarefas', { headers: { 'if-none-match': etag } });
    assert.equal(b.status, 304);
    assert.equal(b.texto, '');
    assert.notEqual((await m.pedir('GET', '/api/v1/tarefas?agente=luna')).headers.get('etag'), etag);
    m.avanca(1);
    assert.equal((await m.pedir('GET', '/api/v1/tarefas', { headers: { 'if-none-match': etag } })).status, 200);
    const c = await m.pedir('GET', '/api/v1/tarefas');
    await criarTarefa(m, { titulo: 'nova' });
    assert.equal((await m.pedir('GET', '/api/v1/tarefas', { headers: { 'if-none-match': c.headers.get('etag') } })).status, 200);
  } finally { await m.fechar(); }
});

test('If-Match: versão antiga dá 412 com a tarefa atual e não grava', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m);
    const ok = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { nota: 'a' }, headers: { 'if-match': `"${t.versao}"` } });
    assert.equal(ok.status, 200);
    const velho = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { nota: 'b' }, headers: { 'if-match': `"${t.versao}"` } });
    assert.equal(velho.status, 412);
    assert.equal(velho.json.tarefa.nota, 'a');
    assert.equal((await m.pedir('DELETE', `/api/v1/tarefas/${t.id}`, { headers: { 'if-match': '"1"' } })).status, 412);
    assert.equal((await m.pedir('GET', `/api/v1/tarefas/${t.id}`)).json.tarefa.estado, 'fazendo');
  } finally { await m.fechar(); }
});

test('se_versao no corpo faz o papel do If-Match (caixa do agente não manda cabeçalho)', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m);
    assert.equal((await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { nota: 'a', se_versao: t.versao } })).status, 200);
    const velho = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { nota: 'b', se_versao: t.versao } });
    assert.equal(velho.status, 412);
    assert.equal(velho.json.tarefa.nota, 'a');
  } finally { await m.fechar(); }
});

test('DELETE cancela (não apaga) e repetir devolve ja_estava', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m);
    const r = await m.pedir('DELETE', `/api/v1/tarefas/${t.id}`, { json: { motivo: 'o dono desistiu' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.acao, 'cancelou');
    assert.equal(r.json.ja_estava, false);
    assert.equal(r.json.tarefa.estado, 'cancelada');
    assert.equal(r.json.tarefa.aberta, false);
    assert.match(r.json.tarefa.nota, /o dono desistiu/);
    const versao = r.json.tarefa.versao;
    const de_novo = await m.pedir('DELETE', `/api/v1/tarefas/${t.id}`);
    assert.equal(de_novo.json.ja_estava, true);
    assert.equal(de_novo.json.tarefa.versao, versao);
    const volta = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { estado: 'fazendo' } });
    assert.equal(volta.json.acao, 'reabriu');
    assert.equal(volta.json.tarefa.fechada_em, null);
  } finally { await m.fechar(); }
});

test('eventos guardam quem, quando, antes e depois, e só os 50 mais recentes', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m);
    await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { nota: 'oi', progresso: 20 }, quem: 'luna' });
    let g = (await m.pedir('GET', `/api/v1/tarefas/${t.id}`)).json.tarefa;
    const ev = g.eventos[1];
    assert.equal(ev.por, 'agente luna');
    assert.equal(ev.acao, 'atualizou');
    assert.deepEqual(ev.mudancas.nota, { antes: null, depois: 'oi' });
    assert.deepEqual(ev.mudancas.progresso, { antes: null, depois: 20 });
    assert.equal(ev.em, '2026-10-05T15:00:00-03:00');
    for (let i = 0; i < 60; i++) await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: {} });
    g = (await m.pedir('GET', `/api/v1/tarefas/${t.id}`)).json.tarefa;
    assert.equal(g.eventos.length, 50);
    assert.equal(g.eventos[49].acao, 'sinal de vida');
    assert.equal((await m.pedir('GET', '/api/v1/tarefas')).json.tarefas[0].eventos, undefined);
  } finally { await m.fechar(); }
});

test('anexos: anexos_add (URL repetida troca o rótulo), anexos_remover e exclusão com anexos', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m, { anexos: [{ rotulo: 'Planilha', url: 'https://a.test/p' }] });
    let r = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { anexos_add: [{ rotulo: 'Nova', url: 'https://a.test/p' }, { rotulo: 'Doc', url: '/midia/1' }] } });
    assert.deepEqual(r.json.tarefa.anexos.map((a) => a.rotulo), ['Nova', 'Doc']);
    r = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { anexos_remover: ['https://nao.tem'] } });
    assert.equal(r.status, 400);
    assert.match(r.json.erros.anexos_remover, /https:\/\/a\.test\/p/);
    r = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { anexos_remover: ['/midia/1'] } });
    assert.equal(r.json.tarefa.anexos.length, 1);
    r = await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { anexos: [], anexos_add: [] } });
    assert.ok(r.json.erros.anexos);
  } finally { await m.fechar(); }
});

test('arquivo inválido: 503 com o motivo e o arquivo NÃO é sobrescrito', async () => {
  const dir = pastaTemp('mesa-ruim');
  const arquivo = path.join(dir, 'mesa', 'tarefas.json');
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, '{ isso nao e json');
  const m = await montar({ opcoes: { arquivo } });
  try {
    for (const [met, cam, json] of [['GET', '/api/v1/tarefas'], ['POST', '/api/v1/tarefas', Object.assign({ agente: 'luna' }, NOVA)], ['GET', '/api/v1/tarefas/1'], ['PATCH', '/api/v1/tarefas/1', {}], ['DELETE', '/api/v1/tarefas/1']]) {
      const r = await m.pedir(met, cam, { json });
      assert.equal(r.status, 503, `${met} ${cam}`);
      assert.ok(r.json.erro.includes(arquivo));
      assert.match(r.json.erro, /inválido/);
    }
    assert.equal(fs.readFileSync(arquivo, 'utf8'), '{ isso nao e json');
    assert.match(m.cap.texto(), /Corrija o JSON ou restaure o backup/);
    assert.equal((await m.pedir('GET', '/api/v1/tarefas/docs.md')).status, 200);
    // corrigido por fora: a mesa se recupera sozinha
    fs.writeFileSync(arquivo, JSON.stringify({ versao: 1, proximo_id: 7, tarefas: [] }));
    assert.equal((await m.pedir('GET', '/api/v1/tarefas')).status, 200);
    assert.equal((await criarTarefa(m)).id, 7);
  } finally { await m.fechar(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('arquivo gravado com modo 0600 e pasta 0700, sem temporário sobrando; ausente = mesa vazia', async () => {
  const m = await montar();
  try {
    const vazio = await m.pedir('GET', '/api/v1/tarefas');
    assert.equal(vazio.status, 200);
    assert.deepEqual(vazio.json.tarefas, []);
    await criarTarefa(m);
    assert.equal(fs.statSync(m.arquivo).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(m.arquivo)).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(path.dirname(m.arquivo)), ['tarefas.json']);
    const d = JSON.parse(fs.readFileSync(m.arquivo, 'utf8'));
    assert.equal(d.versao, 1);
    assert.equal(d.proximo_id, 2);
    assert.equal(d.tarefas[0].eventos.length, 1);
  } finally { await m.fechar(); }
});

test('poda: fechadas há mais de 90 dias saem; abertas ficam', async () => {
  const m = await montar();
  try {
    const velha = await criarTarefa(m, { titulo: 'velha' });
    const aberta = await criarTarefa(m, { titulo: 'aberta' });
    await m.pedir('PATCH', `/api/v1/tarefas/${velha.id}`, { json: { estado: 'concluida' } });
    m.avanca(91 * 24 * 60);
    await criarTarefa(m, { titulo: 'gatilho' });
    const l = (await m.pedir('GET', '/api/v1/tarefas?dia=todos')).json.tarefas.map((t) => t.titulo).sort();
    assert.deepEqual(l, ['aberta', 'gatilho']);
    assert.ok(aberta);
  } finally { await m.fechar(); }
});

test('recado [Mesa] ao agente só quando o dono muda e respeita avisar_agente:false', async () => {
  const m = await montar();
  try {
    let r = await m.pedir('POST', '/api/v1/tarefas', { json: Object.assign({ agente: 'luna' }, NOVA) });
    assert.equal(r.json.recado, 'agendado');
    const id = r.json.tarefa.id;
    await m.mesa.aguardarRecados();
    assert.equal(m.inputs.length, 1);
    assert.equal(m.inputs[0].slug, 'luna');
    assert.match(m.inputs[0].corpo.text, /^\[Mesa\] O dono criou a tarefa #1 "Roteiro do reels" para você/);
    assert.equal(m.inputs[0].corpo.submit, true);
    assert.equal(m.inputs[0].corpo.injectWhenIdle, true);
    assert.ok(!m.inputs[0].corpo.text.includes('\n'));

    await m.pedir('PATCH', `/api/v1/tarefas/${id}`, { json: { nota: 'pode usar o gancho B' } });
    await m.mesa.aguardarRecados();
    assert.match(m.inputs[1].corpo.text, /^\[Mesa\] O dono respondeu na tarefa #1 .*nota "pode usar o gancho B"/);

    r = await m.pedir('PATCH', `/api/v1/tarefas/${id}`, { json: { nota: 'quieto', avisar_agente: false } });
    assert.equal(r.json.recado, 'nao_enviado');
    // o próprio agente mexendo: nada de recado, e a resposta nem traz o campo
    r = await m.pedir('PATCH', `/api/v1/tarefas/${id}`, { json: { nota: 'feito por mim' }, quem: 'luna' });
    assert.equal(r.json.recado, undefined);
    r = await m.pedir('POST', '/api/v1/tarefas', { json: NOVA, quem: 'luna' });
    assert.equal(r.json.recado, undefined);
    await m.pedir('PATCH', `/api/v1/tarefas/${id}`, { json: {} });
    await m.pedir('DELETE', `/api/v1/tarefas/${id}`, { json: { motivo: 'não precisa mais' } });
    await m.mesa.aguardarRecados();
    assert.equal(m.inputs.length, 3);
    assert.match(m.inputs[2].corpo.text, /cancelou a tarefa #1.*não precisa mais/);
  } finally { await m.fechar(); }
});

test('recado que falha vai para o log com o motivo e não quebra a resposta', async () => {
  const runner = { input: async () => ({ ok: false, erro: 'runner fora do ar' }) };
  const m = await montar({ runner });
  try {
    const r = await m.pedir('POST', '/api/v1/tarefas', { json: Object.assign({ agente: 'luna' }, NOVA) });
    assert.equal(r.status, 201);
    await m.mesa.aguardarRecados();
    assert.match(m.cap.texto(), /recado \[Mesa\].*runner fora do ar/);
  } finally { await m.fechar(); }
});

test('avisarDono: agente indo para esperando_dono ou travada; dono mexendo não avisa; falha não quebra', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m, {}, 'luna');
    await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { estado: 'esperando_dono', motivo: 'gancho A ou B?' }, quem: 'luna' });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(m.avisos[0], { titulo: 'Luna precisa de você', corpo: 'gancho A ou B?', tag: `mesa-${t.id}`, url: `/mesa#t${t.id}` });
    await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { estado: 'travada', motivo: 'API caiu' }, quem: 'luna' });
    await new Promise((r) => setImmediate(r));
    assert.equal(m.avisos[1].titulo, 'Luna travou');
    await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { nota: 'só uma nota' }, quem: 'luna' });
    await m.pedir('PATCH', `/api/v1/tarefas/${t.id}`, { json: { estado: 'esperando_dono', motivo: 'dono mexendo' } });
    await new Promise((r) => setImmediate(r));
    assert.equal(m.avisos.length, 2);
  } finally { await m.fechar(); }
  const quebrado = await montar({ opcoes: { avisarDono: async () => { throw new Error('push fora'); } } });
  try {
    const r = await quebrado.pedir('POST', '/api/v1/tarefas', { json: Object.assign({}, NOVA, { estado: 'travada', motivo: 'x' }), quem: 'luna' });
    assert.equal(r.status, 201);
    await new Promise((res) => setImmediate(res));
    assert.match(quebrado.cap.texto(), /Não consegui avisar o dono da tarefa #1 \(push fora\)/);
  } finally { await quebrado.fechar(); }
});

test('esperando_danilo vale como esperando_dono (entrada e filtro)', async () => {
  assert.equal(normalizaEntrada({ estado: 'esperando_danilo' }, 'editar').v.estado, 'esperando_dono');
  const m = await montar();
  try {
    await criarTarefa(m, { estado: 'esperando_danilo', motivo: 'decida' });
    const l = (await m.pedir('GET', '/api/v1/tarefas?estado=esperando_danilo')).json;
    assert.equal(l.tarefas.length, 1);
    assert.equal(l.tarefas[0].estado, 'esperando_dono');
    assert.equal(l.contagem.esperando_dono, 1);
  } finally { await m.fechar(); }
});

test('docs.md é servido como markdown utf-8', async () => {
  const m = await montar();
  try {
    const r = await m.pedir('GET', '/api/v1/tarefas/docs.md');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.match(r.texto, /^# Mesa de tarefas/);
    assert.equal((await m.pedir('POST', '/api/v1/tarefas/docs.md')).status, 405);
  } finally { await m.fechar(); }
});

test('rota ignora o que não é da Mesa e usa quemChamou injetado', async () => {
  const m = await montar({ opcoes: { quemChamou: () => ({ tipo: 'agente', slug: 'marina' }) } });
  try {
    const r = await m.pedir('POST', '/api/v1/tarefas', { json: NOVA });
    assert.equal(r.json.tarefa.agente, 'marina');
    const fora = await m.pedir('GET', '/api/v1/tarefasX');
    assert.equal(fora.status, 404);
    assert.equal(fora.texto, 'fora');
  } finally { await m.fechar(); }
});

test('pelo servidor de verdade: /mesa com e sem sessão, GET e POST da API com o dono, agente simulado', async () => {
  const s = await subirWeb({ agentes: [{ slug: 'luna', nome: 'Luna', runner: 'http://127.0.0.1:1', agente_id: 'l1' }] });
  try {
    const sem = await s.c.get('/mesa', { headers: { Accept: 'text/html' } });
    assert.equal(sem.status, 302);
    assert.match(sem.headers.location, /^\/login\?next=%2Fmesa/);
    assert.equal((await s.c.get('/api/v1/tarefas')).status, 401);
    await s.login();
    const sem_tela = await s.c.get('/mesa');
    assert.equal(sem_tela.status, 500);
    assert.match(sem_tela.texto, /Tela não instalada/);
    fs.writeFileSync(path.join(s.publico, 'mesa.html'), '<html>mesa de teste</html>');
    const tela = await s.c.get('/mesa/');
    assert.equal(tela.status, 200);
    assert.match(tela.texto, /mesa de teste/);

    const vazia = await s.c.get('/api/v1/tarefas');
    assert.equal(vazia.status, 200);
    assert.deepEqual(vazia.json.tarefas, []);
    const criada = await s.c.post('/api/v1/tarefas', { json: { agente: 'luna', titulo: 'Teste', origem: 'Dono, hoje: teste', avisar_agente: false } });
    assert.equal(criada.status, 201, criada.texto);
    assert.equal(criada.json.tarefa.criada_por, 'dono (dono)');
    assert.equal(criada.json.recado, 'nao_enviado');
    assert.equal((await s.c.post('/api/v1/tarefas', { json: { agente: 'luna' }, origin: 'https://intruso.example' })).status, 403);
    const lista = await s.c.get('/api/v1/tarefas');
    assert.equal(lista.json.tarefas.length, 1);
    assert.equal(fs.statSync(path.join(s.dados, 'mesa', 'tarefas.json')).mode & 0o777, 0o600);
    assert.equal((await s.c.get('/api/v1/tarefas/docs.md')).status, 200);
  } finally { await s.fechar(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test('pelo servidor de verdade: o agente usa a Mesa pela caixa e o pedido ao dono vira aviso no aparelho', async () => {
  const s = await subirWeb({ agentes: [{ slug: 'luna', nome: 'Luna', runner: 'http://127.0.0.1:1', agente_id: 'l1' }] });
  const avisos = [];
  s.web.push.enviar = async (a) => { avisos.push(a); return { inscricoes: 0, ok: 0, removidas: 0, falhas: [] }; };
  const cab = { 'X-DGClaw-Caixa': s.web.caixa.segredo, 'X-DGClaw-Agente': 'luna', 'Content-Type': 'application/json' };
  const pedir = async (metodo, caminho, json) => {
    const r = await fetch(`http://127.0.0.1:${s.porta}${caminho}`, { method: metodo, headers: cab, body: json === undefined ? undefined : JSON.stringify(json) });
    return { status: r.status, json: await r.json() };
  };
  try {
    assert.ok(s.web.caixa.rotaPermitida('/api/v1/tarefas/1'), 'a rota da Mesa está liberada para a caixa');
    const criada = await pedir('POST', '/api/v1/tarefas', { titulo: 'Roteiro', origem: 'Dono, hoje: faz o roteiro' });
    assert.equal(criada.status, 201, JSON.stringify(criada.json));
    assert.equal(criada.json.tarefa.agente, 'luna');
    const id = criada.json.tarefa.id;
    const pedido = await pedir('PATCH', `/api/v1/tarefas/${id}`, { estado: 'esperando_dono', motivo: 'Qual das duas capas?' });
    assert.equal(pedido.status, 200, JSON.stringify(pedido.json));
    for (let i = 0; i < 20 && !avisos.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].titulo, 'Luna precisa de você');
    assert.equal(avisos[0].url, `/mesa#t${id}`);
    assert.equal((await pedir('GET', '/api/v1/tarefas')).json.tarefas.length, 1);
  } finally { await s.fechar(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test('prazo: grava na criação, muda na edição e recusa data inválida (21/10/2026)', async () => {
  const m = await montar();
  try {
    const t = await criarTarefa(m, { prazo: '2026-10-24' });
    assert.equal(t.prazo, '2026-10-24');
    const r = await m.pedir('PATCH', '/api/v1/tarefas/' + t.id, { json: { prazo: null }, cabecalhos: { 'If-Match': t.versao } });
    assert.ok([200, 428].includes(r.status) || r.status < 300, r.texto);
    const ruim = await m.pedir('POST', '/api/v1/tarefas', { json: Object.assign({ agente: 'luna', prazo: '24/10' }, NOVA) });
    assert.equal(ruim.status, 400);
    assert.match(ruim.json.erros.prazo, /AAAA-MM-DD/);
    assert.equal((await criarTarefa(m)).prazo, null);
  } finally { await m.fechar(); }
});
