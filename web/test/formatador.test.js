'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// o formatador é um script de navegador: roda num contexto com um window de mentira
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'formatador.js'), 'utf8'), ctx);
const F = ctx.window.DGFormatador;

test('link dentro de `código` não leva a crase de fechar (26/10/2026, mensagem do Tech quebrada)', () => {
  const t = '- `https://smartsau.app.unesc.net/apps/x/events`: o Reverb respondeu. Confira `REVERB_CLIENT_HOST` e `443`.';
  const h = F.formata(F.linkify(F.esc(t)), 'markdown');
  assert.match(h, /<code><a href="https:\/\/smartsau\.app\.unesc\.net\/apps\/x\/events"[^>]*>[^<]*<\/a><\/code>: o Reverb/);
  assert.match(h, /<code>REVERB_CLIENT_HOST<\/code> e <code>443<\/code>\./);
  assert.doesNotMatch(h, /`/);
});

test('visor da Pasta: links entre arquivos viram link do wiki (27/10/2026, pedido do dono)', () => {
  const t = '# Wiki\nRoteiro: ../../erp/COMO-ESTUDAR.md\n- [Cursos](../../erp/cursos.md)\n- [[glossario]] e [[log|o log]]\n\n| a | b |\n|---|---|\n| x | bolsas.md |';
  const h = F.arquivoParaHtml(t, 'index.md', { pasta: true });
  assert.match(h, /<a href="#" class="lnk-pasta" data-pasta="\.\.\/\.\.\/erp\/COMO-ESTUDAR\.md">\.\.\/\.\.\/erp\/COMO-ESTUDAR\.md<\/a>/);
  assert.match(h, /data-pasta="\.\.\/\.\.\/erp\/cursos\.md">Cursos<\/a>/);
  assert.match(h, /data-pasta="glossario\.md">glossario<\/a>/);
  assert.match(h, /data-pasta="log\.md">o log<\/a>/);
  assert.match(h, /<td><a href="#" class="lnk-pasta" data-pasta="bolsas\.md">bolsas\.md<\/a><\/td>/);
});

test('visor da Pasta: esquema, link dentro de link e `código` ficam de fora', () => {
  const h = F.arquivoParaHtml('[j](javascript:alert(1)) [s](https://x.y/a.md) [ver ../a.md](a.md) `b.md` <script>c.md', 'i.md', { pasta: true });
  assert.doesNotMatch(h, /data-pasta="javascript/);
  assert.match(h, /<a href="https:\/\/x\.y\/a\.md" target="_blank" rel="noopener">s<\/a>/);
  assert.match(h, /<a href="#" class="lnk-pasta" data-pasta="a\.md">ver \.\.\/a\.md<\/a>/);
  assert.match(h, /<code>b\.md<\/code>/);
  assert.doesNotMatch(h, /<script/i);
});

test('chat e visor do chat: sem { pasta: true } o link relativo continua texto', () => {
  assert.doesNotMatch(F.arquivoParaHtml('[a](b.md) c.md [[d]]', 'i.md'), /lnk-pasta/);
  assert.doesNotMatch(F.formata(F.linkify(F.esc('[a](b.md)')), 'markdown'), /lnk-pasta/);
});

test('sublista recuada fica dentro do item (27/10/2026, README do Tech virava 5, 6, 7...)', () => {
  const h = F.arquivoParaHtml('1. um\n2. dois:\n   - a\n   - b\n3. tres', 'x.md');
  assert.match(h, /<ol class="lb-lista"><li>um<\/li><li>dois:<ul class="lb-lista"><li>a<\/li><li>b<\/li><\/ul><\/li><li>tres<\/li><\/ol>/);
});
