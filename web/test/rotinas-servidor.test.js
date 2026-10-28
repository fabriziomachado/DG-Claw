'use strict';
// lib/rotinas-servidor.js: os roteiros do servidor na Saúde do servidor, lidos do systemd.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarRotinasServidor, lerVezes, frequencia, diasDe } = require('../lib/rotinas-servidor');

const AGORA = Date.parse('2026-10-28T20:00:00Z');
const us = (iso) => String(Date.parse(iso) * 1000);
const linha = (iso, ident, msg, job) => JSON.stringify({ __REALTIME_TIMESTAMP: us(iso), SYSLOG_IDENTIFIER: ident, MESSAGE: msg, ...(job ? { JOB_RESULT: job } : {}) });

const SHOW = [
  'Id=dgclaw-copia-diaria.timer\nLoadState=loaded\nActiveState=active\nNextElapseUSecRealtime=@1793255503\nTimersCalendar={ OnCalendar=*-*-* 03:30:00 America/Sao_Paulo ; next_elapse=Thu 2026-10-29 06:30:00 UTC }',
  'Id=dgclaw-copia-diaria.service\nLoadState=loaded\nActiveState=inactive\nResult=exit-code',
  'Id=dgclaw-vigia-trafego.timer\nLoadState=loaded\nActiveState=active\nNextElapseUSecRealtime=\nTimersMonotonic={ OnBootUSec=2min ; next_elapse=2min }\nTimersMonotonic={ OnUnitActiveUSec=5min ; next_elapse=5d }',
  'Id=dgclaw-vigia-trafego.service\nLoadState=loaded\nActiveState=inactive\nResult=success',
  'Id=dgclaw-varredura-seguranca.timer\nLoadState=not-found',
  'Id=dgclaw-atualiza-noite.timer\nLoadState=not-found',
].join('\n\n');
const JOURNAL = {
  'dgclaw-copia-diaria.service': [
    linha('2026-10-27T06:33:00Z', 'systemd', 'Starting dgclaw-copia-diaria.service'),
    linha('2026-10-27T06:35:00Z', 'systemd', 'Finished dgclaw-copia-diaria.service', 'done'),
    linha('2026-10-28T06:35:00Z', 'systemd', 'Starting dgclaw-copia-diaria.service'),
    linha('2026-10-28T06:35:01Z', 'dgclaw-copia-diaria', 'dgclaw-copia-diaria: falta a chave pública em /etc/dgclaw/copia/destinatario.txt'),
    linha('2026-10-28T06:35:01Z', 'systemd', 'dgclaw-copia-diaria.service: Failed with result \'exit-code\'.'),
    linha('2026-10-28T06:35:01Z', 'systemd', 'Failed to start dgclaw-copia-diaria.service', 'failed'),
  ].join('\n'),
  'dgclaw-vigia-trafego.service': [
    linha('2026-10-28T19:55:00Z', 'systemd', 'Starting dgclaw-vigia-trafego.service'),
    linha('2026-10-28T19:55:01Z', 'systemd', 'Finished dgclaw-vigia-trafego.service', 'done'),
  ].join('\n'),
};

// systemd de mentira: guarda os comandos e responde com SHOW e JOURNAL
const systemdFalso = (comandos) => async (cmd, args) => {
  comandos.push([cmd, ...args].join(' '));
  if (cmd === 'systemctl' && args[0] === 'show') return { ok: true, saida: SHOW, erro: '' };
  if (cmd === 'journalctl') return { ok: true, saida: JOURNAL[args[1]] || '', erro: '' };
  return { ok: true, saida: '', erro: '' };
};

function cenario() {
  const comandos = [], avisos = [];
  const rodar = systemdFalso(comandos);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotinas-'));
  const push = { enviar: async (a) => { avisos.push(a); } };
  const rs = criarRotinasServidor({ dataDir, push, rodar, agora: () => AGORA });
  return { rs, comandos, avisos, dataDir };
}
function resposta() {
  const r = { status: 0, corpo: '' };
  r.writeHead = (st) => { r.status = st; };
  r.setHeader = () => {};
  r.end = (t) => { r.corpo = t || ''; };
  return r;
}

test('lê do systemd só as rotinas que existem, com a causa da falha', async () => {
  const { rs } = cenario();
  const rotinas = await rs.ler(true);
  assert.deepStrictEqual(rotinas.map((r) => r.id), ['copia', 'trafego']);
  const c = rotinas[0];
  assert.strictEqual(c.estado, 'falhou');
  assert.strictEqual(c.frequencia, 'todo dia às 03:30');
  assert.strictEqual(c.ultima.causa, 'falta a chave pública em /etc/dgclaw/copia/destinatario.txt');
  assert.strictEqual(c.proxima, 1793255503000);
  assert.deepStrictEqual(c.dias.slice(-2).map((d) => d.estado), ['ok', 'falhou']);
  const t = rotinas[1];
  assert.strictEqual(t.frequencia, 'a cada 5 minutos');
  assert.strictEqual(t.estado, 'ok');
  assert.strictEqual(t.proxima, Date.parse('2026-10-28T20:00:01Z'));   // última + 5 min
});

test('falha nova vira um aviso no celular, uma vez só', async () => {
  const { rs, avisos, dataDir } = cenario();
  await rs.vigia();
  await rs.vigia();
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].titulo, 'Cópia de segurança falhou');
  assert.match(avisos[0].corpo, /falta a chave pública/);
  assert.strictEqual(avisos[0].url, '/saude');
  // o servidor reiniciou: o arquivo lembra que já avisou
  const outra = criarRotinasServidor({ dataDir, push: { enviar: async (a) => avisos.push(a) }, rodar: systemdFalso([]), agora: () => AGORA });
  await outra.vigia();
  assert.strictEqual(avisos.length, 1);
});

test('rodar agora só nas rotinas marcadas, e só para o dono', async () => {
  const { rs, comandos } = cenario();
  const chama = async (rota, metodo, sessao) => { const res = resposta(); await rs.rotas({ method: metodo }, res, new URL('https://x' + rota), sessao); return res; };
  assert.strictEqual((await chama('/api/v1/rotinas-servidor', 'GET', { via: 'caixa', agente: 'tech' })).status, 403);
  assert.strictEqual((await chama('/api/v1/rotinas-servidor/trafego/rodar', 'POST', { usuario: 'dono' })).status, 403);
  assert.strictEqual((await chama('/api/v1/rotinas-servidor/xyz/rodar', 'POST', { usuario: 'dono' })).status, 404);
  const ok = await chama('/api/v1/rotinas-servidor/copia/rodar', 'POST', { usuario: 'dono' });
  assert.strictEqual(ok.status, 200);
  assert.ok(comandos.includes('systemctl start --no-block dgclaw-copia-diaria.service'));
  const lista = await chama('/api/v1/rotinas-servidor', 'GET', { usuario: 'dono' });
  assert.strictEqual(JSON.parse(lista.corpo).rotinas.length, 2);
});

test('frequência em palavras e falha consertada no mesmo dia conta como ok', () => {
  assert.strictEqual(frequencia({ TimersCalendar: '{ OnCalendar=*-*-* 06:30:00 ; next_elapse=x }' }), 'todo dia às 03:30');
  assert.strictEqual(frequencia({ TimersCalendar: '{ OnCalendar=2026-10-29 05:00:00 UTC ; next_elapse=x }' }), 'uma vez só');
  const vezes = lerVezes([
    linha('2026-10-28T06:35:01Z', 'systemd', 'Failed to start x', 'failed'),
    linha('2026-10-28T18:16:00Z', 'systemd', 'Finished x', 'done'),
  ].join('\n'), 'x');
  assert.strictEqual(vezes[0].causa, 'O roteiro parou com erro sem dizer o motivo.');
  assert.strictEqual(diasDe(vezes, AGORA, 'America/Sao_Paulo').at(-1).estado, 'ok');
});
