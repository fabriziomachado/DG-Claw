'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarLimites, normaliza, divide } = require('../lib/limites');

const USO = (sessao, semana) => ({ dados: { five_hour: { utilization: sessao, resets_at: '2026-10-21T00:20:00Z' }, seven_day: { utilization: semana, resets_at: '2026-10-25T03:00:00Z' },
  extra_usage: { is_enabled: true, monthly_limit: 4000, used_credits: 0, currency: 'USD', decimal_places: 2 } }, plano: 'pro' });

test('normaliza e divide: números da tela e quem usou somando 100', () => {
  const n = normaliza(USO(38.4, 5).dados);
  assert.deepEqual(n.sessao, { pct: 38, renova: '2026-10-21T00:20:00Z' });
  assert.equal(n.extras.limite, 4000);
  assert.deepEqual(divide([{ slug: 'a', nome: 'A', peso: 2 }, { slug: 'b', nome: 'B', peso: 1 }, { slug: 'c', nome: 'C', peso: 0 }]).map(p => p.pct), [67, 33]);
});

function monta(uso, atividades) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lim-'));
  const comandos = [], avisos = [];
  const ags = [{ slug: 'data', nome: 'Data', tipo: 'agente', home_host: dir }, { slug: 'admin', nome: 'Admin', tipo: 'admin' }];
  const l = criarLimites({
    registro: { estado: () => ({ ok: true, agentes: ags }) },
    conversa: { atividade: async (a) => ({ estado: (atividades || {})[a.slug] || 'ocioso' }), comando: async (a, c) => { comandos.push(`${a.slug} ${c.comando} ${c.argumentos}`); return { status: 202 }; } },
    push: { enviar: async (a) => { avisos.push(a.titulo); } },
    dataDir: dir, agora: () => Date.parse('2026-10-20T20:00:00Z'), buscarUso: async () => uso.atual, homeAdmin: dir,
  });
  return { l, comandos, avisos, dir };
}

test('passou dos pontos: avisa uma vez por janela e liga o modo economia só nos agentes de trabalho', async () => {
  const uso = { atual: USO(85, 74) };
  const { l, comandos, avisos } = monta(uso);
  await l.tick();
  assert.deepEqual(avisos, ['A sessão chegou a 85%', 'A semana chegou a 74%', 'Modo economia ligado']);
  assert.deepEqual(comandos, ['data /model sonnet']);
  assert.equal(l.economia().ativa, true);
  await l.tick();
  assert.equal(avisos.length, 3, 'não repete o aviso na mesma janela');
  assert.equal(comandos.length, 1, 'não troca de novo quem já trocou');
});

test('agente trabalhando espera; semana abaixo do nível desliga e volta ao modelo padrão', async () => {
  const uso = { atual: USO(10, 74) };
  const ativ = { data: 'trabalhando' };
  const { l, comandos } = monta(uso, ativ);
  await l.tick();
  assert.deepEqual(comandos, [], 'trabalhando: não interrompe');
  ativ.data = 'ocioso'; await l.tick();
  assert.deepEqual(comandos, ['data /model sonnet']);
  uso.atual = USO(10, 3); await l.tick();
  assert.equal(l.economia().ativa, false);
  assert.deepEqual(comandos, ['data /model sonnet', 'data /model default']);
});

test('modo economia desligado na configuração não troca nada', async () => {
  const uso = { atual: USO(10, 90) };
  const { l, comandos, dir } = monta(uso);
  fs.writeFileSync(path.join(dir, 'limites.json'), JSON.stringify({ config: { avisar: false, economia: { ligado: false, nivel: 70 } } }));
  await l.tick();
  assert.deepEqual(comandos, []);
  assert.equal(l.economia().ativa, false);
});

test('sessão paralela: mudar o tempo grava e regrava as instruções dos agentes de trabalho', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lim-'));
  const regravados = [];
  const l = criarLimites({
    registro: { estado: () => ({ ok: true, agentes: [{ slug: 'data', nome: 'Data', tipo: 'agente' }, { slug: 'admin', nome: 'Admin', tipo: 'admin' }] }) },
    conversa: { atividade: async () => ({ estado: 'ocioso' }), comando: async () => ({ status: 202 }) }, push: null,
    dataDir: dir, buscarUso: async () => USO(1, 1), homeAdmin: dir, regravar: async (ags) => { regravados.push(...ags.map(a => a.slug)); },
  });
  const corpo = JSON.stringify({ paralela: { minutos: 10 } });
  const req = require('node:stream').Readable.from([Buffer.from(corpo)]);
  req.method = 'POST'; req.headers = { 'content-type': 'application/json', 'content-length': String(corpo.length) };
  let codigo = 0, saida = '';
  const res = { writeHead(c) { codigo = c; return this; }, setHeader() {}, end(b) { saida = String(b || ''); } };
  await l.rotas(req, res, new URL('http://x/api/v1/limites/config'), { via: 'login' });
  assert.equal(codigo, 200, saida);
  assert.deepEqual(JSON.parse(saida).config.paralela, { ligado: true, minutos: 10 });
  assert.deepEqual(regravados, ['data']);
  const salvo = JSON.parse(fs.readFileSync(path.join(dir, 'limites.json'), 'utf8'));
  assert.equal(salvo.config.paralela.minutos, 10);
});
