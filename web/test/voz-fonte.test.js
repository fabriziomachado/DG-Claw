'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { subirWeb } = require('./ajuda');
const { pedacosNavegador, TTS_NAVEGADOR_CHARS } = require('../lib/voz');
const DGVozAparelho = require('../public/voz-aparelho.js');

const AGENTES = [
  { slug: 'ana', nome: 'Ana', tipo: 'agente', runner: 'http://127.0.0.1:9', agente_id: 'ana1', chat_id: 'c_ana', voz: 'abcdefghij12' },
  { slug: 'bia', nome: 'Bia', tipo: 'agente', runner: 'http://127.0.0.1:9', agente_id: 'bia1', chat_id: 'c_bia' },
];

/** Voz falsa: só a Ana tem ElevenLabs; `falha` faz a ElevenLabs responder sem cota. */
function vozFalsa(estado) {
  return {
    microfone: false, semChaveFala: 'sem chave', semChaveMic: 'sem mic',
    vozDoAgente: (a) => !!a.voz,
    async falar(_a, _t, _v, parte) {
      estado.chamadas++;
      if (estado.falha) return { erro: 'O serviço de voz (ElevenLabs) recusou o pedido (HTTP 429).', status: 429 };
      return { audio: Buffer.from('mp3'), chars: 3, partes: 1, parte };
    },
    async cota() { return { erro: 'sem chave', status: 503 }; },
  };
}

async function sobe(estado) {
  const t = await subirWeb({ agentes: AGENTES, opcoesServidor: { voz: vozFalsa(estado) } });
  await t.login();
  return t;
}

test('voz do agente: padrão é o aparelho; escolher ElevenLabs passa a tocar mp3 e fica guardado', async () => {
  const estado = { chamadas: 0 };
  const t = await sobe(estado);
  try {
    let v = await t.c.get('/api/v1/agents/ana/voz');
    assert.deepEqual(v.json, { ok: true, fonte: 'navegador', escolhida: 'navegador', elevenlabs: true });
    let r = await t.c.post('/api/v1/tts', { json: { text: 'Oi.', agent_id: 'ana' } });
    assert.equal(r.json.navegador, true); assert.equal(estado.chamadas, 0, 'voz do aparelho não gasta ElevenLabs');

    v = await t.c.post('/api/v1/agents/ana/voz', { json: { fonte: 'elevenlabs' } });
    assert.equal(v.status, 200); assert.equal(v.json.fonte, 'elevenlabs');
    r = await t.c.post('/api/v1/tts', { json: { text: 'Oi.', agent_id: 'ana' } });
    assert.equal(r.status, 200); assert.equal(r.texto, 'mp3'); assert.equal(estado.chamadas, 1);
    const ana = (await t.c.get('/api/v1/agents')).json.agentes.find((a) => a.id === 'ana');
    assert.equal(ana.voz_fonte, 'elevenlabs');
  } finally { await t.fechar(); }
});

test('voz do agente: ElevenLabs sem cota no começo da fala cai na voz do aparelho com aviso', async () => {
  const estado = { chamadas: 0, falha: true };
  const t = await sobe(estado);
  try {
    await t.c.post('/api/v1/agents/ana/voz', { json: { fonte: 'elevenlabs' } });
    const r = await t.c.post('/api/v1/tts', { json: { text: 'Oi.', agent_id: 'ana' } });
    assert.equal(r.status, 200); assert.equal(r.json.navegador, true); assert.match(r.json.aviso, /voz do aparelho/);
    // no meio da fala (parte > 0) o erro continua erro: os pedaços do aparelho não batem com os da ElevenLabs
    const r2 = await t.c.post('/api/v1/tts', { json: { text: 'Oi.', agent_id: 'ana', parte: 1 } });
    assert.equal(r2.status, 429);
  } finally { await t.fechar(); }
});

test('voz do agente: recusa ElevenLabs sem voz cadastrada e fonte desconhecida', async () => {
  const t = await sobe({ chamadas: 0 });
  try {
    const r = await t.c.post('/api/v1/agents/bia/voz', { json: { fonte: 'elevenlabs' } });
    assert.equal(r.status, 409); assert.match(r.json.erro, /Bia não tem voz da ElevenLabs/);
    assert.equal((await t.c.post('/api/v1/agents/ana/voz', { json: { fonte: 'robo' } })).status, 400);
    assert.equal((await t.c.get('/api/v1/agents/nada/voz')).status, 404);
  } finally { await t.fechar(); }
});

test('pedaços para o aparelho: curtos (o Chrome corta fala longa) e sem formatação', () => {
  const longo = Array.from({ length: 30 }, (_, i) => `Frase número ${i} da resposta.`).join(' ');
  const { partes } = pedacosNavegador(`# Título\n\n${longo}`);
  assert.ok(partes.length > 1);
  for (const p of partes) assert.ok(p.length <= TTS_NAVEGADOR_CHARS, p);
  assert.ok(!partes.join(' ').includes('#'));
  assert.equal(pedacosNavegador('```\ncodigo\n```').status, 400);
});

test('voz do aparelho: português do Brasil e vozes naturais primeiro, outras línguas fora', () => {
  const v = (name, lang) => ({ name, lang });
  const ordem = DGVozAparelho.ordena([
    v('Google US English', 'en-US'), v('Microsoft Maria', 'pt-BR'), v('Joana', 'pt-PT'),
    v('Microsoft Thalita Online (Natural)', 'pt-BR'), v('Google português do Brasil', 'pt-BR'),
  ]).map((x) => x.name);
  assert.deepEqual(ordem, ['Microsoft Thalita Online (Natural)', 'Google português do Brasil', 'Microsoft Maria', 'Joana']);
});
