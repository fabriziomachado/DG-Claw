'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { subirWeb } = require('./ajuda');

test('GET /api/v1/atividade: o estado de todos os agentes, só para quem entrou', async () => {
  const agentes = [
    { slug: 'admin', nome: 'Admin', tipo: 'admin', runner: 'http://127.0.0.1:1', agente_id: 'a0' },
    { slug: 'ana', nome: 'Ana', runner: 'http://127.0.0.1:1', agente_id: 'a1' },
  ];
  const t = await subirWeb({ agentes });
  try {
    const sem = await t.c.get('/api/v1/atividade');
    assert.equal(sem.status, 401);
    await t.login();
    const r = await t.c.get('/api/v1/atividade');
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(Object.keys(r.json.agentes).sort(), ['admin', 'ana']);
    assert.equal(r.json.agentes.ana.estado, 'sem_sinal');
    assert.deepEqual(Object.keys(r.json.agentes.ana), ['estado', 'parado_desde'], 'só o estado e desde quando está parado (avatar dormindo), sem passo nem detalhe');
  } finally { await t.fechar(); }
});
