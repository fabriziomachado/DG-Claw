'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pastaTemp } = require('./ajuda');
const { criarMencoes } = require('../lib/mencoes');

test('menções: pergunta vai ao mencionado, a resposta volta como cartão e o agente de origem recebe um recado', async () => {
  const agentes = { help: { slug: 'help', nome: 'Help', chat_id: 'c_help' }, data: { slug: 'data', nome: 'Data' }, admin: { slug: 'admin', tipo: 'admin' } };
  const registro = { obter: (s) => agentes[s] || null };
  const enviados = [], entregues = [];
  let msgsData = [], estadoData = 'trabalhando', t = 1000000000;
  const conversa = {
    enviar: async (a, { text }) => { enviados.push([a.slug, text]); return { status: 200, corpo: { ep_enviado: t / 1000 } }; },
    thread: async (a) => ({ msgs: a.slug === 'data' ? msgsData : [], versao: 1 }),
    atividade: async () => ({ estado: estadoData }),
    entregar: async (a, texto, o) => { entregues.push([a.slug, texto, o]); return { status: 200 }; },
  };
  const m = criarMencoes({ config: { dataDir: pastaTemp('men') }, registro, conversa, agora: () => t, passoMs: 5, quietoMs: 0 });
  assert.equal((await m.criar(agentes.help, { para: 'admin', pergunta: 'x' })).status, 400, 'o Admin não é mencionável');
  assert.equal((await m.criar(agentes.help, { para: 'help', pergunta: 'x' })).status, 400);
  const r = await m.criar(agentes.help, { para: 'data', pergunta: 'quantos chamados por curso?' });
  assert.equal(r.status, 200);
  assert.deepEqual(enviados[0], ['data', '[pergunta feita na conversa do Help] quantos chamados por curso?']);
  let tela = m.junta('help', { msgs: [], versao: 7 });
  assert.deepEqual(tela.msgs.map((x) => x.origin), ['dono', 'mencao']);
  assert.equal(tela.msgs[1].mencao.estado, 'perguntando');
  t += 5000;
  msgsData = [{ id: 'a1', origin: 'agente', ep: t / 1000, text: 'Direito 412, Psicologia 388.' }];
  estadoData = 'pronto';
  await new Promise((ok) => setTimeout(ok, 60));
  tela = m.junta('help', { msgs: [], versao: 7 });
  assert.equal(tela.msgs[1].mencao.estado, 'respondida');
  assert.equal(tela.msgs[1].text, 'Direito 412, Psicologia 388.');
  assert.notEqual(tela.versao, 7, 'a versão muda para o stream mandar de novo');
  assert.equal(entregues[0][0], 'help'); assert.match(entregues[0][1], /^<plataforma recado="mencao"/); assert.match(entregues[0][1], /c_help/); assert.equal(entregues[0][2].cru, true);
});

test('pedido para a equipe: todos recebem, só o primeiro pega, só ele entrega, e o cartão acompanha', async () => {
  const agentes = { help: { slug: 'help', nome: 'Help' }, data: { slug: 'data', nome: 'Data' }, tech: { slug: 'tech', nome: 'Tech' }, admin: { slug: 'admin', nome: 'Admin', tipo: 'admin' } };
  const registro = { obter: (s) => agentes[s] || null, estado: () => ({ agentes: Object.values(agentes) }) };
  const entregues = [];
  const conversa = { entregar: async (a, t) => { entregues.push([a.slug, t]); return { status: 200 }; }, thread: async () => ({ msgs: [] }), atividade: async () => ({}) };
  const m = criarMencoes({ config: { dataDir: pastaTemp('ped') }, registro, conversa });
  const r = await m.pedir(agentes.help, { texto: 'total de inadimplentes por curso' });
  assert.equal(r.status, 200);
  assert.deepEqual(entregues.map((e) => e[0]).sort(), ['data', 'help', 'tech'], 'o Admin não recebe');
  assert.match(entregues[0][1], new RegExp(`/api/v1/pedidos/${r.corpo.id}/pegar`));
  const id = r.corpo.id;
  assert.equal(m.pegar('data', id).status, 200);
  const outro = m.pegar('tech', id);
  assert.equal(outro.status, 409); assert.match(outro.corpo.erro, /Data já pegou/);
  assert.equal(m.entregarPedido('tech', id, { resposta: 'x' }).status, 403);
  assert.equal(m.entregarPedido('data', id, { resposta: '1.284 alunos' }).status, 200);
  const tela = m.junta('help', { msgs: [], versao: 1 });
  assert.equal(tela.msgs[0].text, '@todos total de inadimplentes por curso');
  assert.equal(tela.msgs[1].mencao.tipo, 'pedido'); assert.equal(tela.msgs[1].mencao.estado, 'feito'); assert.equal(tela.msgs[1].mencao.donoPor, 'data');
  assert.equal(tela.msgs[1].text, '1.284 alunos');
  const av = m.registrarAviso(agentes.help, { texto: 'feriado amanhã', para: ['data', 'help'], avisoId: 12 });
  assert.equal(av.status, 200);
  const t2 = m.junta('help', { msgs: [], versao: 1 });
  assert.equal(t2.msgs[2].text, '@Data @Help feriado amanhã');
  assert.equal(t2.msgs[3].mencao.tipo, 'aviso');
});
