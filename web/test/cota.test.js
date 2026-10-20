'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { horaDaVolta, falta } = require('../public/cota');

test('horaDaVolta: a frase da Anthropic vira a próxima vez dessa hora no fuso dela', () => {
  const agora = new Date('2026-10-19T23:48:00Z');   // 20:48 em São Paulo
  assert.equal(horaDaVolta("You've hit your session limit · resets 9:30pm (America/Sao_Paulo)", agora).toISOString(), '2026-10-20T00:30:00.000Z');
  assert.equal(horaDaVolta('resets 3am (America/Sao_Paulo)', agora).toISOString(), '2026-10-20T06:00:00.000Z');
  assert.equal(horaDaVolta('resets 8pm (America/Sao_Paulo)', agora).toISOString(), '2026-10-20T23:00:00.000Z', 'hora que já passou hoje é amanhã');
  assert.equal(horaDaVolta('sem horário', agora), null);
});
test('falta: minutos e horas em português', () => {
  assert.equal(falta(42 * 60000), '42 min');
  assert.equal(falta(138 * 60000), '2 h 18 min');
  assert.equal(falta(-1), 'a qualquer momento');
});
