'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarLeitor } = require('../lib/thread');

test('cada resposta do agente leva os tokens do turno e o que ele guardou na memória', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memtok-'));
  const f = path.join(dir, 's.jsonl');
  const ts = (s) => new Date(Date.UTC(2026, 9, 20, 0, 0, s)).toISOString();
  const linhas = [
    { type: 'user', timestamp: ts(0), message: { role: 'user', content: '<dgchat from="pessoa" chat="c_data" msg="m1" ts="x">só a base clinica</dgchat>' } },
    { type: 'assistant', timestamp: ts(5), message: { id: 'a1', usage: { input_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50, output_tokens: 30 },
      content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: "python3 - <<'EOF'\np='MEMORY.md'; s=open(p).read()\ns=s.replace(\"## Regras aprendidas\\n\\n\",\"## Regras aprendidas\\n\\n- (20/10) Só a base clinica nas análises.\\n\")\nopen(p,'w').write(s)\nEOF" } }] } },
    // a mesma mensagem repetida no transcript não soma de novo
    { type: 'assistant', timestamp: ts(5), message: { id: 'a1', usage: { input_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50, output_tokens: 30 }, content: [] } },
    { type: 'assistant', timestamp: ts(9), message: { id: 'a2', usage: { input_tokens: 3, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 70 },
      content: [{ type: 'tool_use', id: 't2', name: 'mcp__dgchat__reply', input: { chat: 'c_data', text: 'Combinado.' } }] } },
  ];
  fs.writeFileSync(f, linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const leitor = criarLeitor({ log: () => {}, tz: 'America/Sao_Paulo', canalTelegram: false, midia: { registrar: () => null } });
  const { eventos } = leitor.ler(f, { slug: 'data', nome: 'Data', chat_id: 'c_data', agente_id: 'data' });
  const fala = eventos.find((e) => e.quem === 'agente' && e.text === 'Combinado.');
  assert.ok(fala, 'a fala do agente existe');
  assert.deepEqual(fala.uso, { entrada: 3055, cache: 3000, saida: 100, ms: 9000 });
  assert.deepEqual(fala.memorias, [{ tipo: 'Regra', texto: '(20/10) Só a base clinica nas análises.' }]);
});

test('memória gravada depois da última fala, em prosa ou por heredoc, vai para essa fala (20/10/2026)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memtok-'));
  const f = path.join(dir, 's.jsonl');
  const ts = (s) => new Date(Date.UTC(2026, 9, 20, 0, 0, s)).toISOString();
  const usa = (id, s, nome, input) => ({ type: 'assistant', timestamp: ts(s), message: { id, content: [{ type: 'tool_use', id: 't' + id, name: nome, input }] } });
  const linhas = [
    { type: 'user', timestamp: ts(0), message: { role: 'user', content: '<dgchat from="pessoa" chat="c_admin" msg="m1" ts="x">aprende com o erro</dgchat>' } },
    usa('a1', 2, 'mcp__dgchat__reply', { chat: 'c_admin', text: 'Achei o erro.' }),
    usa('a2', 3, 'Write', { file_path: '/root/.claude/projects/x/memory/imagens.md', content: '---\nname: imagens\ndescription: Imagens do chat vão para prints/, nunca para o /tmp\nmetadata:\n  type: feedback\n---\n\nTexto longo.' }),
    usa('a3', 4, 'Bash', { command: "cd /root/.claude/projects/x/memory && cat >> backlog.md <<'EOF'\n40. Chip de memória corrigido no fim do turno.\nEOF" }),
    usa('a4', 5, 'Bash', { command: 'echo "- [Imagens](imagens.md) — send_file só mostra o que está na casa" >> /root/.claude/projects/x/memory/MEMORY.md' }),
    { type: 'user', timestamp: ts(9), message: { role: 'user', content: '<dgchat from="pessoa" chat="c_admin" msg="m2" ts="x">ok</dgchat>' } },
  ];
  fs.writeFileSync(f, linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const leitor = criarLeitor({ log: () => {}, tz: 'America/Sao_Paulo', canalTelegram: false, midia: { registrar: () => null } });
  const { eventos } = leitor.ler(f, { slug: 'admin', nome: 'Admin', chat_id: 'c_admin', agente_id: 'admin' });
  const fala = eventos.find((e) => e.text === 'Achei o erro.');
  assert.deepEqual(fala.memorias, [
    { tipo: 'Regra', texto: 'Imagens do chat vão para prints/, nunca para o /tmp' },
    { tipo: 'Fato', texto: 'Chip de memória corrigido no fim do turno.' },
    { tipo: 'Fato', texto: 'Imagens — send_file só mostra o que está na casa' },
  ]);
});

test('/model sonnet vira a linha do modo economia, sem balão do dono nem resultado do comando', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memtok-'));
  const f = path.join(dir, 's.jsonl');
  const ts = (s) => new Date(Date.UTC(2026, 9, 20, 18, 10, s)).toISOString();
  const linhas = [
    { type: 'user', timestamp: ts(0), message: { role: 'user', content: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>sonnet</command-args>' } },
    { type: 'user', timestamp: ts(1), message: { role: 'user', content: '<local-command-stdout>Set model to Sonnet</local-command-stdout>' } },
  ];
  fs.writeFileSync(f, linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const leitor = criarLeitor({ log: () => {}, tz: 'America/Sao_Paulo', canalTelegram: false, midia: { registrar: () => null } });
  const { eventos } = leitor.ler(f, { slug: 'data', nome: 'Data', chat_id: 'c_data', agente_id: 'data' });
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].origin, 'linha');
  assert.equal(eventos[0].text, '15:10 · modo economia ligado, Data usa o Sonnet até a semana renovar');
});
