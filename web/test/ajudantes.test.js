'use strict';
// Ajudantes: a lista que o servidor tira do runner e as partes puras da tela.
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarAjudantes } = require('../lib/ajudantes');
const Tela = require('../public/ajudantes');

function runnerFalso(sessoes, conversas = {}) {
  const chamadas = [];
  return {
    chamadas,
    chamar: async (agente, metodo, caminho) => {
      chamadas.push(caminho);
      if (caminho === '/api/agents?todas=1') return { ok: true, corpo: { data: sessoes } };
      const m = /^\/api\/agents\/([^/]+)\/conversation/.exec(caminho);
      if (m) return { ok: true, corpo: { data: conversas[decodeURIComponent(m[1])] || [] } };
      return { ok: false };
    },
  };
}
const card = (id, status, extra = {}) => ({ id, status, updatedAt: 1000, createdAt: 10 * 3600_000 - 60_000, sessao: { papel: 'paralela', tipo: 'card', titulo: 'Card ' + id, fila: 0, ociosoHaMin: 0, ...extra } });

test('lista: trabalhando, parado sem nunca começar, e o card que terminou some', async () => {
  const r = runnerFalso([
    { id: 'principal', status: 'idle', sessao: { papel: 'principal' } },
    card('a', 'working'),
    card('b', 'resumable', { ociosoHaMin: 20 }),
    card('c', 'idle', { ociosoHaMin: 20 }),
    card('d', 'idle', { ociosoHaMin: 0.5 }),
    card('e', 'errored'),
    card('f', 'waiting_input'),
    { ...card('g', 'resumable', { ociosoHaMin: 300 }), createdAt: 0 },
  ], { c: [{ role: 'assistant', text: 'pronto' }] });
  const l = await criarAjudantes({ runner: r, agora: () => 10 * 3600_000 }).lista({ slug: 'x' });
  assert.deepEqual(l.map(a => [a.id, a.estado, a.motivo]), [['a', 'trabalhando', ''], ['b', 'parado', 'não começou'], ['e', 'parado', 'parou com erro'], ['f', 'pede', 'pede permissão']],
    'o g, aberto há 10 h e dormindo, não conta como parado');
  assert.equal(l[0].titulo, 'Card a');
});

test('lista: guarda por alguns segundos e não quebra quando o runner não responde', async () => {
  let t = 0;
  const r = runnerFalso([card('a', 'working')]);
  const aj = criarAjudantes({ runner: r, agora: () => t });
  await aj.lista({ slug: 'x' }); await aj.lista({ slug: 'x' });
  assert.equal(r.chamadas.length, 1, 'a segunda leitura vem do cache');
  t = 60000;
  const fora = { chamar: async () => ({ ok: false, erro: 'fora do ar' }) };
  assert.deepEqual(await criarAjudantes({ runner: fora }).lista({ slug: 'y' }), []);
});

test('tela: selo, tempo e linhas (parado primeiro, texto escapado)', () => {
  assert.equal(Tela.selo([]), null);
  assert.deepEqual(Tela.selo([{ estado: 'trabalhando' }, { estado: 'parado' }]), { n: 2, parado: true });
  assert.equal(Tela.tempo(0, 30_000), 'agora');
  assert.equal(Tela.tempo(0, 12 * 60_000), '12 min');
  assert.equal(Tela.tempo(0, 65 * 60_000), '1 h 05');
  const h = Tela.linhasHtml([{ id: 'a', estado: 'trabalhando', titulo: '<b>x</b>', desde: 0 }, { id: 'b', estado: 'parado', titulo: 'Perfil', motivo: 'não começou' }], 'Data', 120_000);
  assert.ok(h.indexOf('Ajudante parado') < h.indexOf('Ajudante trabalhando'));
  assert.match(h, /Avisar Data/);
  assert.match(Tela.linhasHtml([{ id: 'c', estado: 'pede', titulo: 'T' }], 'Data', 0), /pede permissão/);
  assert.deepEqual(Tela.selo([{ estado: 'pede' }]), { n: 1, parado: true });
  assert.doesNotMatch(h, /<b>x<\/b>/);
  assert.doesNotMatch(h, /[—–]/);
});
