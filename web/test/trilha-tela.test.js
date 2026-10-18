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
  assert.equal(T.rotuloPasso({ ferramenta: 'Bash', comando: 'npm test\nmais', titulo: 'Roda os testes' }), 'Roda os testes');
  assert.equal(T.rotuloPasso({ ferramenta: 'Bash', comando: 'cd /tmp/x; python3 varrer.py --dias 30', titulo: 'cd /tmp/x; python3 varrer.py --dias 30' }), 'Rodando o script varrer.py');
  assert.equal(T.rotuloPasso({ ferramenta: 'Edit', titulo: 'editou /home/agente/working-memory.md' }), 'working-memory.md');
  assert.equal(T.rotuloPasso({ ferramenta: 'WebSearch', titulo: 'evasão EAD 2024' }), 'evasão EAD 2024');
  assert.equal(T.tipoPasso('Grep'), 'buscar');
  assert.equal(T.duracao(72), '1 min 12 s');
});

test('humanoComando: traduz o comando numa frase simples', () => {
  const H = require('../public/trilha-tela.js').humanoComando;
  assert.equal(H("python3 - <<'E'\nprint(1)\nE"), 'Rodando um script em Python');
  assert.equal(H('cd /home/agente/softdesk && python3 /home/agente/softdesk/varrer.py 99300 97100'), 'Rodando o script varrer.py');
  assert.equal(H('umask 077; cab=$(mktemp); curl -sS -H @"$cab" https://suporte.unesc.net/api/api.php/chamado/99213'), 'Consultando suporte.unesc.net');
  assert.equal(H('sed -n 1,60p doc.txt'), 'Lendo doc.txt');
  assert.equal(H('grep -n foo *.md | head'), 'Procurando nos arquivos');
  assert.equal(H('git push https://github.com/x/y.git ramo'), 'Enviando ao GitHub');
  assert.equal(H('ls -la /home/agente/entregas'), 'Olhando a pasta entregas');
  assert.equal(H('timeout 60 node /w/olho.mjs'), 'Rodando o script olho.mjs');
  assert.equal(H('xyzzy --faz'), 'Rodando um comando');
});
