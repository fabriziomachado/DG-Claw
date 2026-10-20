'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarVigiaAlertas, resumo } = require('../lib/vigia-alertas');
const { criarAlertas, marcar } = require('../lib/alertas');

function monta(agora) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
  const agentes = [{ slug: 'data', nome: 'Data', chat_id: 'c_data' }, { slug: 'help', nome: 'Help', chat_id: 'c_help' }];
  const enviados = [];
  let vigia = null;
  const alertas = (a) => criarAlertas(path.join(dir, a.slug + '.json'), a.chat_id, (item) => vigia.aoNovo(a, item));
  const msgs = { data: [], help: [] };
  const conversa = { thread: async (a) => { alertas(a).observar(msgs[a.slug].map(marcar)); return { msgs: msgs[a.slug] }; } };
  const push = { enviar: async (av) => { enviados.push(av); return { inscricoes: 1, ok: 1, falhas: [] }; } };
  vigia = criarVigiaAlertas({ registro: { estado: () => ({ ok: true, agentes }) }, conversa, alertas, push, log: () => {}, agora: () => agora });
  return { vigia, msgs, enviados };
}

test('vigia: pedido e entrega novos viram aviso com o número no ícone; mensagem comum não', async () => {
  const agora = 1_800_000_000_000, ep = agora / 1000 - 30;
  const { vigia, msgs, enviados } = monta(agora);
  msgs.data.push({ id: 'm1', ep, origin: 'agente', text: '[PEDIDO] Posso rodar a consulta pesada agora?\n\n```dgui\n{"tipo":"escolha"}\n```' });
  msgs.help.push({ id: 'm2', ep, origin: 'agente', text: '[ENTREGA] O **relatório** de chamados está pronto.' });
  msgs.help.push({ id: 'm3', ep, origin: 'agente', text: 'Só uma resposta comum.' });
  await vigia.tique();
  await new Promise((r) => setImmediate(r));
  assert.equal(enviados.length, 2);
  const p = enviados.find((a) => a.titulo.startsWith('Data'));
  assert.equal(p.titulo, 'Data precisa da sua decisão');
  assert.equal(p.corpo, 'Posso rodar a consulta pesada agora?');
  assert.equal(p.url, '/a/data');
  const e = enviados.find((a) => a.titulo.startsWith('Help'));
  assert.equal(e.titulo, 'Help: entrega pronta');
  assert.equal(e.corpo, 'O relatório de chamados está pronto.');
  assert.equal(e.contador, 2, 'o número soma os alertas não vistos de todos os agentes');
  // a segunda passada não repete
  await vigia.tique();
  assert.equal(enviados.length, 2);
});

test('vigia: alerta antigo (mais de 15 min) não dispara aviso na primeira passada', async () => {
  const agora = 1_800_000_000_000;
  const { vigia, msgs, enviados } = monta(agora);
  msgs.data.push({ id: 'velha', ep: agora / 1000 - 3600, origin: 'agente', text: '[PEDIDO] Pergunta de ontem' });
  await vigia.tique();
  assert.equal(enviados.length, 0);
  assert.equal(vigia.pendentes(), 1, 'o alerta antigo continua contando no número');
});

test('resumo: tira blocos e marcação e corta em frase curta', () => {
  assert.equal(resumo('**Oi**, veja `x`\n\n```js\ncodigo\n```\n# Fim'), 'Oi, veja x Fim');
  assert.ok(resumo('palavra '.repeat(60)).length <= 140);
});
