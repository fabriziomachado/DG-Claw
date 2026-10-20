'use strict';
// Cota que volta antes da hora (20/10/2026, pedido do dono: "colei mais créditos, precisa prever isso").
//
// O aviso de limite do painel vem da última fala do registro do agente ("You've hit your weekly limit ·
// resets Oct 25"), então ele não sabe quando a conta libera antes: crédito extra, plano novo, limite que
// voltou. Enquanto a conversa mostra a tarja, ela pergunta aqui; daqui sai, no máximo a cada 5 minutos
// por agente, um teste curto de dentro da caixa dele (`claude -p` com o modelo pequeno e sem guardar
// sessão). Se responde, a conta liberou e a tarja some sozinha, mandando o que ficou guardado.
// Um teste recusado pelo limite não gasta nada; o que passa gasta uma resposta curta, uma vez.
//
// GET /api/v1/agents/<slug>/cota?desde=<desde do aviso> -> { ok, liberada, conferido_em, conferindo }

const { execFile } = require('node:child_process');

const INTERVALO_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 90 * 1000;

/** O teste passou? Saída 0 e nada de limite na resposta. */
function respondeu(err, saida) {
  if (err) return false;
  const t = String(saida || '');
  return !!t.trim() && !/hit your .*limit|usage limit|rate.?limit|credit balance/i.test(t);
}

function testePadrao(agente) {
  const container = agente.container || `dgclaw-${agente.slug}`;
  return new Promise((ok) => execFile('podman', ['exec', '-u', 'agente', '-w', '/tmp', container,
    'claude', '-p', '--model', 'haiku', '--no-session-persistence', 'Responda só: ok'],
  { timeout: TIMEOUT_MS }, (err, stdout, stderr) => ok(respondeu(err, String(stdout || '') + String(stderr || '')))));
}

function criarCotaVigia({ log = () => {}, testar = testePadrao, agora = () => Date.now() } = {}) {
  const estado = new Map();   // slug -> { desde, liberada, em, rodando }

  /** Devolve o que já se sabe e, se está velho, dispara um teste novo (sem esperar por ele). */
  function consulta(agente, desde) {
    let e = estado.get(agente.slug);
    if (!e || e.desde !== desde) { e = { desde, liberada: false, em: 0, rodando: null }; estado.set(agente.slug, e); }
    if (!e.liberada && !e.rodando && agora() - e.em >= INTERVALO_MS) {
      e.rodando = testar(agente).then((sim) => {
        e.em = agora(); e.liberada = !!sim;
        if (sim) log('info', `${agente.slug}: a conta liberou antes da hora do aviso de limite; a tarja da cota sai sozinha.`);
      }).catch((er) => { e.em = agora(); log('aviso', `${agente.slug}: não consegui testar a cota (${er.message}).`); })
        .finally(() => { e.rodando = null; });
    }
    return { ok: true, liberada: e.liberada, conferido_em: e.em ? new Date(e.em).toISOString() : null, conferindo: !!e.rodando };
  }

  return { consulta };
}

module.exports = { criarCotaVigia, respondeu };
