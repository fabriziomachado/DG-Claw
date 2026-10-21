'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../public/onboarding');
const lê = f => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

test('carrega em Node sem window e expõe as funções puras', () => {
  assert.equal(typeof O.textoPilula, 'function');
  assert.equal(typeof O.passoOtimista, 'function');
  assert.equal(typeof O.marcadorParaBotao, 'function');
});

test('textoPilula: antes do envio, criando, parou e pronto', () => {
  for (const tela of ['inicio', 'boas-vindas', 'formulario']) {
    assert.equal(O.textoPilula({ tela, fase: 'boas-vindas', nome: 'Sofia' }), 'Continuar a criação do agente');
  }
  assert.equal(O.textoPilula({ tela: 'criando:x', fase: 'criando', nome: 'Sofia' }), 'Criando o Sofia… ver');
  assert.equal(O.textoPilula({ tela: 'x', fase: 'login', nome: '' }), 'Criando seu agente… ver');
  assert.equal(O.textoPilula({ tela: 'x', fase: 'testando', nome: 'Sofia', comErro: true }), 'A criação do Sofia parou. Ver');
  assert.equal(O.textoPilula({ tela: 'x', fase: 'pronto', nome: 'Sofia' }), 'Sofia está pronto. Ver');
  for (const fase of ['solicitado', 'enviando', 'criando', 'testando', 'login', 'erro', 'pronto'])
    for (const comErro of [true, false])
      assert.doesNotMatch(O.textoPilula({ tela: 'x', fase, nome: 'Ana', comErro }), /[—–]/);
});

test('marcador [ver a criação] vira botão; sem marcador nada muda', () => {
  const h = O.marcadorParaBotao('<div class="p">Oi<br>[ver a criação]</div>');
  assert.match(h, /<button type="button" class="nas-reabrir" data-abrir-criacao>/);
  assert.doesNotMatch(h, /\[ver a criação\]/);
  assert.equal(O.marcadorParaBotao('texto <b>normal</b>'), 'texto <b>normal</b>');
  assert.doesNotMatch(h, /[—–]/);
});

test('passoOtimista: nunca volta, respeita o teto, só chega a 100 com real 100', () => {
  let e = 0;
  for (let i = 0; i < 400; i++) {
    const n = O.passoOtimista(e, 20, 40);
    assert.ok(n >= e, 'não volta');
    assert.ok(n <= 20 + 0.92 * 20 + 1e-9, 'não passa do teto');
    e = n;
  }
  assert.ok(e > 38 && e < 40);
  assert.equal(O.passoOtimista(50, 30, 40), 50);            // real menor que o exibido: fica parado
  assert.ok(O.passoOtimista(50, 30, 90) >= 50);            // teto novo passou do exibido: volta a andar
  assert.equal(O.passoOtimista(10, 35, 35), 35);           // real maior: salta; sem próximo, não anda mais
  assert.equal(O.passoOtimista(35, 35, 35), 35);           // erro ou pronto: proximo igual ao real
  assert.ok(O.passoOtimista(99, 90, 100) < 100);
  assert.equal(O.passoOtimista(99, 100, 100), 100);
});

test('onboarding.js: modal fora do chat, acessível e sem travessão em texto novo', () => {
  const js = lê('onboarding.js');
  assert.doesNotMatch(js, /getElementById\('chat'\)\.appendChild/);
  assert.match(js, /document\.body\.append\(modal/);
  assert.match(js, /'role', 'dialog'/);
  assert.match(js, /'aria-modal', 'true'/);
  assert.match(js, /Fechar e continuar no chat/);
  assert.match(js, /nas-modal-aberto/);
  assert.match(js, /data-abrir-criacao/);
  assert.match(js, /abrir = \(\) => reabrir/);
  assert.doesNotMatch(js, /host\.hidden/);
  assert.doesNotMatch(js, /setTimeout\(\(\) => \{ animando = null; encerraAnimacao/);
});

test('onboarding.css: z-index do modal, celular e movimento reduzido', () => {
  const css = lê('onboarding.css');
  assert.match(css, /\.nas-modal\{[^}]*z-index:80/);
  assert.match(css, /\.nas-pilula\{[^}]*z-index:32/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.nas-modal,\.nas-caixa\{animation:none/);
  assert.match(css, /100dvh - 12px - env\(safe-area-inset-top\)/);
  assert.match(css, /\.nas-reabrir\{/);
});

test('conversa.js usa o marcador só fora do dono, e o service worker subiu de versão', () => {
  const cj = lê('conversa.js');
  assert.match(cj, /!ehDono\(m\) && window\.DGOnboarding && window\.DGOnboarding\.marcadorParaBotao/);
  assert.match(lê('sw.js'), /dgclaw-estaticos-v(1[5-9]|[2-9][0-9]|[1-9][0-9]{2,})\b/);
});

test('a chegada do agente reabre o modal mesmo se a pessoa o minimizou (criação pela conversa)', () => {
  assert.match(lê('onboarding.js'), /if \(pronto\) minimizado = false;\n\s*abreModal\(\);/);
});
