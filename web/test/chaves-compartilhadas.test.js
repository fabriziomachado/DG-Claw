'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/chaves-compartilhadas');

function cenario() {
  const cofres = { ana: ['GROQ_API_KEY', 'GEMINI_API_KEY', 'GITHUB_TOKEN'], bia: ['GROQ_API_KEY'], novo: [] };
  const agentes = [{ slug: 'admin', tipo: 'admin' }, ...Object.keys(cofres).map((s) => ({ slug: s, nome: s.toUpperCase(), cofre_arquivo: '/x/' + s }))];
  const registro = { estado: () => ({ agentes }), obter: (s) => agentes.find((a) => a.slug === s) };
  const copias = [];
  const cofre = {
    ativas: (a) => (cofres[a.slug] || []).map((envName) => ({ envName })),
    copiar: (de, para, nome) => { copias.push([de.slug, para.slug, nome]); cofres[para.slug].push(nome); return { ok: true }; },
  };
  return { registro, cofre, copias, novo: registro.obter('novo') };
}

test('chaves compartilhadas: oferece só Groq e Gemini, copia o que falta e diz o que ainda falta', () => {
  const s = cenario();
  assert.deepEqual(C.disponiveis(s.registro, s.cofre, 'novo').map((d) => [d.envName, d.de]), [['GROQ_API_KEY', 'ana'], ['GEMINI_API_KEY', 'ana']]);
  assert.deepEqual(C.faltam(s.cofre, s.novo), ['GROQ_API_KEY', 'GEMINI_API_KEY']);
  assert.deepEqual(C.copiarPara(s.registro, s.cofre, s.novo, 'Dono'), ['GROQ_API_KEY', 'GEMINI_API_KEY']);
  assert.ok(!s.copias.some((c) => c[2] === 'GITHUB_TOKEN'), 'token do GitHub não é compartilhado sozinho');
  assert.deepEqual(C.faltam(s.cofre, s.novo), []);
  assert.deepEqual(C.copiarPara(s.registro, s.cofre, s.novo, 'Dono'), [], 'o que já tem não copia de novo');
});
