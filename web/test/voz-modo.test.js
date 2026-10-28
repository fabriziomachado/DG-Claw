'use strict';
// Conversa por voz (voz-modo.js, 26/10/2026): o arquivo fica separado e depende da ponte do conversa.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = f => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

test('a ponte do conversa.js entrega o que o modo de voz usa', () => {
  const c = pub('conversa.js');
  const ini = c.indexOf('window.DGConversaVoz = {');
  assert.ok(ini > 0, 'falta window.DGConversaVoz no conversa.js');
  const ponte = c.slice(ini, c.indexOf('};', ini));
  for (const nome of ['estado:', 'caps', 'audio:', 'set continua', 'set ler', 'destravarAudio', 'comecaGravar', 'paraEEnvia', 'cancelaGravacao', 'cancelaFala']) {
    assert.ok(ponte.includes(nome), 'a ponte não tem ' + nome);
  }
  assert.ok(c.indexOf("new Event('dgconversa-voz')") > ini, 'a ponte não avisa que está pronta');
});

test('voz-modo carrega depois do conversa.js e entra no cache do app', () => {
  const html = pub('conversa.html');
  const a = html.indexOf('<script src="/conversa.js">'), b = html.indexOf('<script src="/voz-modo.js">');
  assert.ok(a > 0 && b > a, 'voz-modo.js precisa vir depois do conversa.js');
  assert.ok(html.includes('href="/voz-modo.css"'));
  const sw = pub('sw.js');
  assert.ok(sw.includes("'/voz-modo.js'") && sw.includes("'/voz-modo.css'"));
});

test('voz-modo só usa o conversa.js pela ponte', () => {
  const v = pub('voz-modo.js');
  assert.ok(v.includes('window.DGConversaVoz') && v.includes("'dgconversa-voz'"));
  // variáveis internas do conversa.js não existem fora dele
  const codigo = v.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const nome of ['lerRespostas', 'gravacao', 'micAbrindo', 'ctxAudio', 'drenoAtivo', 'AGENTE']) {
    assert.ok(!new RegExp('(^|[^.\\w])' + nome + '\\b', 'm').test(codigo), 'voz-modo.js usa ' + nome + ' direto');
  }
});

test('digitação: carregada na conversa, no cache do app e desligada no modo escondido', () => {
  const html = pub('conversa.html');
  assert.ok(html.indexOf('<script src="/digitacao.js">') > html.indexOf('<script src="/conversa.js">'));
  assert.ok(pub('sw.js').includes("'/digitacao.js'"));
  const d = pub('digitacao.js');
  assert.ok(d.includes('sigiloLigado()') && d.includes('prefers-reduced-motion'));
});

test('trocar de agente com o microfone silenciado: o modo reabre ainda silenciado', () => {
  const v = pub('voz-modo.js');
  assert.match(v, /JSON\.stringify\(\{ em: Date\.now\(\), mudo \}\)/, 'a marca da troca precisa levar o silenciado');
  assert.match(v, /abre\(true, marca\.mudo === true\)/, 'a volta precisa abrir com o silenciado da marca');
  assert.match(v, /mudo = silenciado === true/);
  assert.match(v, /if \(!mudo && !semToque/, 'silenciado não abre o microfone sozinho');
});
