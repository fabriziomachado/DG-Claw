'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarBoasVindas, noSilencio, comBloco, blocoPerfil, validaPerfil, validaAvisos } = require('../lib/boas-vindas');

const TZ = 'America/Sao_Paulo';
// 21/10/2026 às 23h em São Paulo (UTC-3) = 22/10 02:00 UTC
const AS_23H = Date.UTC(2026, 9, 22, 2, 0);
const AS_8H = Date.UTC(2026, 9, 22, 11, 0);
const AS_15H = Date.UTC(2026, 9, 21, 18, 0);

test('silêncio que vira a noite vale às 23h e às 3h, não às 8h nem às 15h', () => {
  const s = { ativo: true, de: '22:00', ate: '07:00' };
  assert.equal(noSilencio(s, AS_23H, TZ), true);
  assert.equal(noSilencio(s, Date.UTC(2026, 9, 22, 6, 0), TZ), true);
  assert.equal(noSilencio(s, AS_8H, TZ), false);
  assert.equal(noSilencio(s, AS_15H, TZ), false);
  assert.equal(noSilencio({ ativo: false, de: '22:00', ate: '07:00' }, AS_23H, TZ), false);
});

test('validação do perfil e dos avisos', () => {
  assert.ok(validaPerfil({ nome: '' }).erro);
  assert.ok(validaPerfil({ nome: 'Ana', area: 'Marte' }).erro);
  assert.ok(validaPerfil({ nome: 'Ana', prioridades: ['Hackear'] }).erro);
  assert.deepEqual(validaPerfil({ nome: ' Ana <b> ', area: 'Tecnologia', prioridades: ['Chamados', 'Chamados'] }).perfil,
    { nome: 'Ana b', area: 'Tecnologia', prioridades: ['Chamados'] });
  assert.ok(validaAvisos({ silencio: { de: '25:00' } }).erro);
  assert.deepEqual(validaAvisos({ entregas: false, silencio: { ativo: true } }).avisos,
    { pedidos: true, entregas: false, silencio: { ativo: true, de: '22:00', ate: '07:00' } });
});

test('o bloco do perfil troca só o trecho marcado do MEMORY.md', () => {
  const b1 = blocoPerfil({ nome: 'Ana', area: 'Tecnologia', prioridades: [] });
  const t1 = comBloco('# Memória\n\nfato do agente\n', b1);
  assert.match(t1, /fato do agente\n\n<!-- s2bot:perfil-dono inicio/);
  const t2 = comBloco(t1 + '\noutro fato\n', blocoPerfil({ nome: 'Bia', area: '', prioridades: ['Chamados'] }));
  assert.doesNotMatch(t2, /Ana/);
  assert.match(t2, /Nome: Bia/);
  assert.match(t2, /outro fato/);
  assert.equal(t2.split('s2bot:perfil-dono inicio').length, 2);
});

function monta(agoraMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-'));
  fs.chmodSync(dir, 0o700);
  const enviados = [];
  const push = { enviar: async (a) => { enviados.push(a); return { ok: 1 }; } };
  let agora = agoraMs;
  const bv = criarBoasVindas({
    config: { dataDir: dir, tz: TZ }, registro: { estado: () => ({ ok: true, agentes: [] }) },
    caixa: { gravaRetrato() {} }, push, log() {}, agora: () => agora,
  });
  return { dir, bv, enviados, mudaHora: (ms) => { agora = ms; } };
}

test('no silêncio o aviso é guardado e sai um resumo só no fim', async () => {
  const { dir, bv, enviados, mudaHora } = monta(AS_23H);
  fs.writeFileSync(path.join(dir, 'preferencias-avisos.json'), JSON.stringify({ pedidos: true, entregas: true, silencio: { ativo: true, de: '22:00', ate: '07:00' } }));
  await bv.avisar({ titulo: 'Help precisa da sua decisão', corpo: 'x', contador: 2 }, 'pedido');
  await bv.avisar({ titulo: 'Tech: entrega pronta', corpo: 'y', contador: 3 }, 'entrega');
  await bv.avisar({ titulo: 'Data precisa da sua decisão', corpo: 'z', contador: 4 }, 'pedido');
  assert.equal(enviados.length, 0);
  bv.tique();
  assert.equal(enviados.length, 0, 'ainda no silêncio');
  mudaHora(AS_8H);
  bv.tique();
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].titulo, 'Enquanto você descansava');
  assert.equal(enviados[0].corpo, '2 pedidos de decisão e 1 entrega esperando por você.');
  assert.equal(enviados[0].contador, 4);
  bv.tique();
  assert.equal(enviados.length, 1, 'o resumo não repete');
});

test('tipo desligado não toca; sem escolha nenhuma tudo toca na hora', async () => {
  const { dir, bv, enviados } = monta(AS_23H);
  await bv.avisar({ titulo: 'a', corpo: 'b' }, 'entrega');
  assert.equal(enviados.length, 1, 'padrão: sem silêncio');
  fs.writeFileSync(path.join(dir, 'preferencias-avisos.json'), JSON.stringify({ pedidos: true, entregas: false, silencio: { ativo: false } }));
  const r = await bv.avisar({ titulo: 'a', corpo: 'b' }, 'entrega');
  assert.ok(r.pulado);
  await bv.avisar({ titulo: 'c', corpo: 'd' }, 'pedido');
  assert.equal(enviados.length, 2);
});
