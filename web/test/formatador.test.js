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
