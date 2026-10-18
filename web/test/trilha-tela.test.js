'use strict';
// trilha-tela.js: os passos de cada pedido (linha do campo e resumo "Fez N passos").
const test = require('node:test');
const assert = require('node:assert');

test('passos por pedido: junta os passos até a próxima fala do dono, mesmo com fala do agente no meio', () => {
  const T = require('../public/trilha-tela.js');
  const tr = (id, f, c) => ({ id, origin: 'trilha', trilha: { ferramenta: f, titulo: c, comando: c } });
  const b = T.agrupaPorTurno([
    { id: 'd1', origin: 'dono' }, { id: 'a1', origin: 'agente' }, tr('t1', 'Read', '/a/b.csv'),
    { id: 'a2', origin: 'agente' }, tr('t2', 'Bash', 'npm test\nmais'), { id: 'd2', origin: 'dono' }, tr('t3', 'Bash', 'ls'),
  ]);
  assert.deepEqual(b.map((x) => (x.msg ? x.msg.id : x.trilha.map((i) => i.id).join('+'))), ['d1', 'a1', 't1+t2', 'a2', 'd2', 't3']);
  assert.equal(T.rotuloPasso({ ferramenta: 'Bash', comando: 'npm test\nmais', titulo: 'Roda os testes' }), 'npm test');
  assert.equal(T.rotuloPasso({ ferramenta: 'Edit', titulo: 'editou /home/agente/working-memory.md' }), 'working-memory.md');
  assert.equal(T.rotuloPasso({ ferramenta: 'WebSearch', titulo: 'evasão EAD 2024' }), 'evasão EAD 2024');
  assert.equal(T.tipoPasso('Grep'), 'buscar');
  assert.equal(T.duracao(72), '1 min 12 s');
});
