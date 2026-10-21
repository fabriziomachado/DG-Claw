'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarCotaVigia, respondeu } = require('../lib/cota-vigia');

test('respondeu: só vale saída boa sem frase de limite', () => {
  assert.equal(respondeu(null, 'ok\n'), true);
  assert.equal(respondeu(null, "You've hit your weekly limit · resets Oct 25, 12am"), false);
  assert.equal(respondeu(new Error('saiu 1'), 'ok'), false);
  assert.equal(respondeu(null, '  '), false);
});

test('consulta testa no máximo a cada 5 min por aviso e lembra quando liberou', async () => {
  let t = 1e6, testes = 0, resposta = false;
  const v = criarCotaVigia({ agora: () => t, testar: async () => { testes++; return resposta; } });
  const ag = { slug: 'help' };
  v.consulta(ag, 'd1'); await new Promise(r => setImmediate(r));
  assert.equal(testes, 1);
  t += 60000; v.consulta(ag, 'd1'); await new Promise(r => setImmediate(r));
  assert.equal(testes, 1, 'antes de 5 min não testa de novo');
  resposta = true; t += 5 * 60000; v.consulta(ag, 'd1'); await new Promise(r => setImmediate(r));
  assert.equal(testes, 2);
  assert.equal(v.consulta(ag, 'd1').liberada, true);
  assert.equal(testes, 2, 'liberada não testa mais');
  resposta = false; assert.equal(v.consulta(ag, 'd2').liberada, false, 'aviso novo começa do zero');
});
