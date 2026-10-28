'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../public/leitura-destaque.js');

test('marca-texto: o texto falado (limpo) acha o lugar na tela (formatada) e volta à posição original', () => {
  // o que a tela mostra (o link aparece só com o texto dele) com os símbolos que a fala tira
  const tela = 'Professor, a resposta do «Tech» chegou: → 2027/1 ← tem 139 matrículas.';
  const t = D.normaliza(tela), f = D.normaliza('a resposta do Tech chegou: 2027/1 tem 139 matrículas.');
  const i = D.acha(t.n, f.n, 0);
  assert.ok(i >= 0);
  assert.equal(tela.slice(t.mapa[i], t.mapa[i + f.n.length - 1] + 1), 'a resposta do «Tech» chegou: → 2027/1 ← tem 139 matrículas');
});

test('marca-texto: busca segue em frente (frase repetida pega a próxima) e cai no começo do trecho se o fim mudou', () => {
  const t = D.normaliza('Ok. Feito. Ok. Fim.').n;
  const ok = D.normaliza('Ok.').n;
  const primeiro = D.acha(t, ok, 0);
  assert.equal(D.acha(t, ok, primeiro + ok.length), t.lastIndexOf('ok'));
  const longo = D.normaliza('Uma frase bem comprida que passa de quarenta letras e depois muda no fim').n;
  const tela = D.normaliza('Uma frase bem comprida que passa de quarenta letras e depois termina diferente').n;
  assert.equal(D.acha(tela, longo, 0), 0);
  assert.equal(D.acha(tela, D.normaliza('nada a ver').n, 0), -1);
});

test('marca-texto: frases do trecho com posição', () => {
  const t = 'Oi. Tudo bem? Sim!\nFim';
  assert.deepEqual(D.frases(t).map((f) => t.slice(f.ini, f.fim).trim()), ['Oi.', 'Tudo bem?', 'Sim!', 'Fim']);
});
