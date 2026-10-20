'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pastaTemp } = require('./ajuda');
const { criarFeedback } = require('../lib/feedback');

test('feedback: 👍 vira recado de guardar na memória, 👎 de perguntar; repetir não manda de novo', async () => {
  const entregues = [];
  const conversa = { entregar: async (a, t, o) => { entregues.push([t, o]); return { status: 200 }; } };
  const f = criarFeedback({ config: { dataDir: pastaTemp('fb') }, conversa });
  const ag = { slug: 'ana', chat_id: 'c_ana' };
  const thread = { msgs: [{ id: 'a1', origin: 'agente', text: 'Mensalidade média R$ 744' }, { id: 'd1', origin: 'dono', text: 'oi' }] };
  assert.equal((await f.votar(ag, thread, { mensagem: 'd1', tipo: 'bom' })).status, 404, 'só resposta do agente');
  assert.equal((await f.votar(ag, thread, { mensagem: 'a1', tipo: 'xx' })).status, 400);
  await f.votar(ag, thread, { mensagem: 'a1', tipo: 'bom' });
  assert.match(entregues[0][0], /recado="feedback" tipo="bom"/); assert.equal(entregues[0][1].cru, true);
  await f.votar(ag, thread, { mensagem: 'a1', tipo: 'bom' });
  assert.equal(entregues.length, 1);
  await f.votar(ag, thread, { mensagem: 'a1', tipo: 'ruim' });
  assert.match(entregues[1][0], /tipo="ruim"[\s\S]*c_ana/);
  assert.deepEqual(f.votos('ana'), { a1: 'ruim' });
  await f.votar(ag, thread, { mensagem: 'a1', tipo: '' });
  assert.deepEqual(f.votos('ana'), {});
});
