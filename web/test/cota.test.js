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
test('horaDaVolta: o limite semanal vem com o dia (20/10/2026)', () => {
  const agora = new Date('2026-10-20T19:30:00Z');
  assert.equal(horaDaVolta("You've hit your weekly limit · resets Oct 25, 12am (America/Sao_Paulo)", agora).toISOString(), '2026-10-25T03:00:00.000Z');
  assert.equal(horaDaVolta('resets Jan 2, 3:15pm (America/Sao_Paulo)', new Date('2026-12-30T12:00:00Z')).toISOString(), '2027-01-02T18:15:00.000Z');
  assert.equal(horaDaVolta('resets Foo 2, 3pm (America/Sao_Paulo)', agora), null);
  assert.equal(falta(4 * 86400000 + 5 * 3600000), '4 dias 5 h');
});
