'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarCaixaEntrada, escolhaDe } = require('../lib/caixa-entrada');
const { criarAlertas, marcar } = require('../lib/alertas');

test('escolhaDe: acha o cartão de escolha e as opções, ignora outro dgui', () => {
  const t = 'Posso?\n\n```dgui\n{"tipo":"kpi","valor":"1"}\n```\n\n```dgui\n{"tipo":"escolha","pergunta":"Rodo agora?","opcoes":[{"texto":"Sim","recomendada":true},"Não"]}\n```';
  const e = escolhaDe(t);
  assert.equal(e.pergunta, 'Rodo agora?');
  assert.deepEqual(e.opcoes.map(o => o.texto), ['Sim', 'Não']);
  assert.equal(e.opcoes[0].recomendada, true);
  assert.equal(escolhaDe('sem cartão'), null);
});

test('caixa: junta pedidos e entregas não vistos de todos os agentes, pedidos primeiro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caixa-'));
  const agentes = [{ slug: 'data', nome: 'Data', chat_id: 'c1' }, { slug: 'help', nome: 'Help', chat_id: 'c2' }];
  const alertas = (a) => criarAlertas(path.join(dir, a.slug + '.json'), a.chat_id);
  alertas(agentes[0]).observar([{ id: 'm1', ep: 100, origin: 'agente', text: '[PEDIDO] Rodo a consulta?\n```dgui\n{"tipo":"escolha","pergunta":"Rodo?","opcoes":["Sim","Não"]}\n```' }].map(marcar));
  alertas(agentes[1]).observar([{ id: 'm2', ep: 200, origin: 'agente', text: '[ENTREGA] Relatório pronto.' }].map(marcar));
  const cx = criarCaixaEntrada({ registro: { estado: () => ({ ok: true, agentes }) }, alertas, log: () => {} });
  const l = cx.itens();
  assert.deepEqual(l.map(i => [i.tipo, i.agente]), [['pedido', 'data'], ['entrega', 'help']]);
  assert.equal(l[0].texto, 'Rodo a consulta?');
  assert.deepEqual(l[0].opcoes.map(o => o.texto), ['Sim', 'Não']);
  // visto sai da caixa
  alertas(agentes[1]).reconhecer(l[1].id);
  assert.equal(cx.itens().length, 1);
});

test('caixa: um agente pela caixa dele não lê a caixa do dono', async () => {
  const cx = criarCaixaEntrada({ registro: { estado: () => ({ ok: true, agentes: [] }) }, alertas: () => ({}), log: () => {} });
  let status = 0;
  const res = { writeHead: (s) => { status = s; }, setHeader() {}, end() {} };
  await cx.rotas({ method: 'GET' }, res, new URL('http://x/api/v1/caixa'), { via: 'caixa', agente: 'data' });
  assert.equal(status, 403);
});
