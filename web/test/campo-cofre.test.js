'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cc = require('../public/campo-cofre.js');
const fs = require('node:fs');
const path = require('node:path');

test('analisa: bloco dgcofre válido, com e sem rótulo', () => {
  assert.deepStrictEqual(cc.analisa('dgcofre\nGROQ_API_KEY\n'), { envName: 'GROQ_API_KEY', rotulo: '' });
  assert.deepStrictEqual(cc.analisa('dgcofre\nGROQ_API_KEY\nChave da Groq'), { envName: 'GROQ_API_KEY', rotulo: 'Chave da Groq' });
  assert.deepStrictEqual(cc.analisa('dgcofre\nGROQ\\_API\\_KEY'), { envName: 'GROQ_API_KEY', rotulo: '' });
});

test('analisa: nome inválido ou outra linguagem cai no bloco normal (null)', () => {
  for (const b of ['dgcofre\ngroq_key', 'dgcofre\nA', 'dgcofre\n1ABC', 'dgcofre\nA B', 'dgcofre\n', 'js\nGROQ_API_KEY', 'dgcofre\n<img>']) {
    assert.strictEqual(cc.analisa(b), null, b);
  }
});

test('html: escapa nome e rótulo e usa input de senha', () => {
  const h = cc.html('GROQ_API_KEY', '<b>"x"</b>', 'id1');
  assert.ok(!h.includes('<b>"x"</b>'));
  assert.ok(h.includes('&lt;b&gt;&quot;x&quot;&lt;/b&gt;'));
  assert.ok(h.includes('type="password"') && h.includes('autocomplete="off"') && h.includes('spellcheck="false"'));
  assert.ok(h.includes('Salvar no cofre'));
});

test('blocoParaHtml: devolve null para nome inválido e HTML para válido', () => {
  assert.strictEqual(cc.blocoParaHtml('dgcofre\nminuscula', 'x'), null);
  assert.ok(cc.blocoParaHtml('dgcofre\nGEMINI_API_KEY', 'msg').includes('GEMINI_API_KEY'));
});

test('conversa.js liga o gancho e o html carrega os arquivos novos', () => {
  const pub = path.join(__dirname, '..', 'public');
  assert.match(fs.readFileSync(path.join(pub, 'conversa.js'), 'utf8'), /campoCofre\.blocoParaHtml/);
  const html = fs.readFileSync(path.join(pub, 'conversa.html'), 'utf8');
  assert.ok(html.includes('/campo-cofre.js') && html.includes('/campo-cofre.css'));
});

test('alvo: `slug:NOME` só vira campo na conversa do Admin e grava no cofre do outro agente', () => {
  assert.deepStrictEqual(cc.analisa('dgcofre\nhelp:SOFTDESK_HASH_API\nChave do SoftDesk'),
    { envName: 'SOFTDESK_HASH_API', rotulo: 'Chave do SoftDesk', alvo: 'help' });
  for (const b of ['dgcofre\nHelp:X_KEY', 'dgcofre\n../x:X_KEY', 'dgcofre\nhelp:minuscula', 'dgcofre\n:X_KEY']) {
    assert.strictEqual(cc.analisa(b), null, b);
  }
  cc.configurar({ agente: 'smartsau', outrosAgentes: false });
  assert.strictEqual(cc.blocoParaHtml('dgcofre\nhelp:SOFTDESK_HASH_API', 'm'), null);
  cc.configurar({ agente: 'admin', outrosAgentes: true });
  const h = cc.blocoParaHtml('dgcofre\nhelp:SOFTDESK_HASH_API', 'm');
  assert.ok(h.includes('data-alvo="help"') && h.includes('cofre de help') && h.includes('SOFTDESK_HASH_API'));
  assert.ok(!cc.blocoParaHtml('dgcofre\nGROQ_API_KEY', 'm').includes('data-alvo'));
  cc.configurar({ agente: '', outrosAgentes: false });
});
