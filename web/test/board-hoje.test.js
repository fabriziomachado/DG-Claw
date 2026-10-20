'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { entendeFrase, descreve } = require('../public/board-hoje');

const agora = new Date(2026, 9, 19, 23, 30);   // segunda, 19/10/2026, 23h30
const casos = [
  ['me lembra amanhã às 9h de ligar pro contador', 'Ligar pro contador', '2026-10-20', '09:00'],
  ['sexta às 14h reunião com a PROEN', 'Reunião com a PROEN', '2026-10-23', '14:00'],
  ['me lembra de pagar o boleto amanhã', 'Pagar o boleto', '2026-10-20', '09:00'],
  ['às 8 da noite ligar pra mãe', 'Ligar pra mãe', '2026-10-20', '20:00'],
  ['dia 25 às 10:30 entregar relatório', 'Entregar relatório', '2026-10-25', '10:30'],
  ['amanhã 15h30 dentista', 'Dentista', '2026-10-20', '15:30'],
  ['me lembre de ligar pro João às 3 da tarde amanhã', 'Ligar pro João', '2026-10-20', '15:00'],
];
test('entendeFrase: data, hora e texto em português', () => {
  for (const [f, texto, data, hora] of casos) {
    const r = entendeFrase(f, agora);
    assert.ok(r, f);
    assert.equal(r.texto, texto, f);
    assert.deepEqual(r.regra, { tipo: 'unico', data, hora }, f);
  }
});
test('entendeFrase: "daqui a" vira daqui_min; sem quando, ou hoje já passado, devolve null', () => {
  assert.deepEqual(entendeFrase('daqui a 30 min tirar o bolo', agora), { texto: 'Tirar o bolo', daqui_min: 30 });
  assert.deepEqual(entendeFrase('em 2 horas ligar', agora), { texto: 'Ligar', daqui_min: 120 });
  assert.equal(entendeFrase('comprar pão', agora), null);
  assert.equal(entendeFrase('hoje às 8h reunião', agora), null);
});
test('descreve: o que foi entendido, em português', () => {
  assert.equal(descreve(entendeFrase('amanhã às 9h x', agora), agora), 'amanhã (20/10) às 09:00');
  assert.equal(descreve({ daqui_min: 30 }, agora), 'daqui a 30 min');
});
