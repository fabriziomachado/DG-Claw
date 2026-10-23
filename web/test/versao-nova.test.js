'use strict';
// Versão nova do S2 Bot: as releases do fork viram o botão do rodapé e a janela (lib/versao-nova.js,
// public/versao-nova.js). O GitHub é um dublê; nada sai para a rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { subirWeb, pastaTemp } = require('./ajuda');
const V = require('../lib/versao-nova');
const T = require('../public/versao-nova.js');

const AGENTES = [{ slug: 'admin', nome: 'Admin', tipo: 'admin', runner: 'http://x', agente_id: 'admin' }];
const NOTAS = 'Texto.\n\n## Conversa\n- **Menu do ➕** com anexar\n- Arrastar [arquivo](https://x)\n- Rascunho\n- Aviso de conversa pesada\n- Histórico\n* <img src=x onerror=alert(1)>\n';

function release(extra) {
  return Object.assign({ tag_name: 'v1.5.0-s2bot', name: 'S2 Bot 1.5 (24/10/2026)', body: NOTAS,
    html_url: 'https://github.com/fabriziomachado/DG-Claw/releases/tag/v1.5.0-s2bot', published_at: '2026-10-24T10:00:00Z' }, extra || {});
}
async function web(versao, resposta) {
  const app = pastaTemp('vn');
  fs.writeFileSync(path.join(app, 'VERSAO-S2BOT'), versao + '\n');
  const pedidos = [];
  const buscar = async (url) => { pedidos.push(url); const r = resposta(); return { ok: r.status === 200, status: r.status, json: async () => r.corpo }; };
  const w = await subirWeb({ agentes: AGENTES, opcoesServidor: { appDirVersao: app, buscarVersaoNova: buscar } });
  await w.login();
  return Object.assign(w, { pedidos });
}

test('comparação de versões e versão curta', () => {
  assert.equal(V.maisNova('v1.4.0-s2bot', '1.3.0'), true);
  assert.equal(V.maisNova('v1.3.0-s2bot', '1.3.0'), false);
  assert.equal(V.maisNova('v1.10.0', '1.9.9'), true);
  assert.equal(V.maisNova('lixo', '1.0.0'), false);
  assert.equal(V.curta('v1.4.0-s2bot'), '1.4');
  assert.equal(V.curta('1.3.2'), '1.3.2');
});

test('itens da release: os primeiros tópicos, sem markdown, e quantos sobram', () => {
  const r = V.itensDasNotas(NOTAS);
  assert.deepEqual(r.itens, ['Menu do ➕ com anexar', 'Arrastar arquivo', 'Rascunho', 'Aviso de conversa pesada']);
  assert.equal(r.mais, 2);
  const longo = V.itensDasNotas('- ' + 'palavra '.repeat(30)).itens[0];
  assert.ok(longo.endsWith('…') && Array.from(longo).length <= 111 && !/\s…$/.test(longo), longo);
});

test('release mais nova no fork: a API mostra a nova; "agora não" esconde até sair outra', async () => {
  const w = await web('1.4.0', () => ({ status: 200, corpo: release() }));
  try {
    let r = await w.c.post('/api/v1/versao-nova/checar', { json: {} });
    assert.equal(r.status, 200, r.texto);
    assert.equal(w.pedidos[0], 'https://api.github.com/repos/fabriziomachado/DG-Claw/releases/latest', 'olha o fork, nunca o original');
    assert.equal(r.json.atual_curta, '1.4');
    assert.equal(r.json.nova.tag, 'v1.5.0-s2bot');
    assert.equal(r.json.nova.curta, '1.5');
    assert.equal(r.json.dispensada, false);
    r = await w.c.post('/api/v1/versao-nova/agora-nao', { json: {} });
    assert.equal(r.json.dispensada, true);
    r = await w.c.post('/api/v1/versao-nova/auto', { json: { ligado: false } });
    assert.equal(r.json.auto, false);
    r = await w.c.post('/api/v1/versao-nova/auto', { json: { ligado: 'sim' } });
    assert.equal(r.status, 400);
  } finally { await w.fechar(); }
});

test('mesma versão, tag estranha, link de fora e GitHub fora do ar', async () => {
  let resp = { status: 200, corpo: release({ tag_name: 'v1.4.0-s2bot' }) };
  const w = await web('1.4.0', () => resp);
  try {
    let r = await w.c.post('/api/v1/versao-nova/checar', { json: {} });
    assert.equal(r.json.nova, null);
    resp = { status: 200, corpo: release({ tag_name: 'v2.0.0"><script>' }) };
    r = await w.c.post('/api/v1/versao-nova/checar', { json: {} });
    assert.equal(r.json.nova, null);
    assert.match(r.json.erro, /não tem uma versão que eu reconheça/);
    resp = { status: 200, corpo: release({ html_url: 'https://mau.example/x' }) };
    r = await w.c.post('/api/v1/versao-nova/checar', { json: {} });
    assert.equal(r.json.nova.url, null, 'link que não é das releases do fork não sai');
    resp = { status: 503, corpo: {} };
    r = await w.c.post('/api/v1/versao-nova/checar', { json: {} });
    assert.match(r.json.erro, /GitHub respondeu 503/);
    assert.equal(r.json.nova.tag, 'v1.5.0-s2bot', 'a última que deu certo continua valendo');
  } finally { await w.fechar(); }
});

test('sem sessão: 401', async () => {
  const w = await subirWeb({ agentes: AGENTES });
  try { assert.equal((await w.c.get('/api/v1/versao-nova')).status, 401); } finally { await w.fechar(); }
});

test('tela: o texto do release sai escapado e o pedido ao Admin é fixo', () => {
  const d = { atual: '1.4.0', atual_curta: '1.4', auto: true, nova: { tag: 'v1.5.0-s2bot', curta: '1.5', itens: ['<img src=x onerror=alert(1)>'], mais: 3, url: 'https://github.com/fabriziomachado/DG-Claw/releases/tag/v1.5.0-s2bot' } };
  const h = T.htmlJanela(d);
  assert.ok(!h.includes('<img'));
  assert.match(h, /&lt;img/);
  assert.match(h, /e mais 3 ajustes/);
  assert.match(h, /volta sozinho para a 1\.4/);
  assert.equal(T.htmlBotao(Object.assign({}, d, { dispensada: true })), '');
  assert.match(T.htmlBotao(d), /Atualização disponível/);
  assert.equal(T.textoDoPedido('v1.5.0-s2bot'), '[do botão Atualizar do S2 Bot] atualiza o S2 Bot para a versão v1.5.0-s2bot (release do fork, com backup e volta automática)');
});
