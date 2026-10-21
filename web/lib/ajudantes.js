'use strict';
// Ajudantes dos agentes (21/10/2026, ideia do dono): as sessões paralelas (cards) que cada agente abriu,
// para a fileira mostrar um selo e a conversa uma linha "Ajudante trabalhando". Lê o runner do agente
// (GET /api/agents?todas=1) e só devolve o que interessa ao dono:
//   - trabalhando: o card está num turno;
//   - pede: o card espera uma permissão (o dono decide nas Sessões);
//   - parado: o card nunca começou (aberto há menos de 3 h, ocioso, sem fila e sem nenhuma mensagem há
//     PARADO_MIN minutos) ou parou com erro. Foi o caso real: o pedido sumiu na entrega e o agente esperou 30 min por nada.
// Card que terminou o turno e está ocioso com resposta não aparece (não há nada a acompanhar).

const PARADO_MIN = 2;
const CACHE_MS = 8000;
const RECENTE_MS = 3 * 3600_000;

function criarAjudantes({ runner, agora = Date.now }) {
  const cache = new Map(); // slug -> { em, lista }
  const recente = (s) => typeof s.createdAt === 'number' && agora() - s.createdAt < RECENTE_MS;

  async function semMensagens(agente, id) {
    const r = await runner.chamar(agente, 'GET', `/api/agents/${encodeURIComponent(id)}/conversation?limit=1`, null, 3000);
    if (!r.ok || !r.corpo) return false;
    return Array.isArray(r.corpo.data) && r.corpo.data.length === 0;
  }

  /** [{ id, titulo, estado: 'trabalhando'|'parado', desde (ms), motivo }] ou [] se o runner não respondeu. */
  async function lista(agente) {
    const c = cache.get(agente.slug);
    if (c && agora() - c.em < CACHE_MS) return c.lista;
    const r = await runner.chamar(agente, 'GET', '/api/agents?todas=1', null, 3000);
    const saida = [];
    if (r.ok && r.corpo && Array.isArray(r.corpo.data)) {
      for (const s of r.corpo.data) {
        const sess = s.sessao || {};
        if (sess.papel !== 'paralela') continue;
        const base = { id: String(s.id || ''), titulo: String(sess.titulo || 'Ajudante').slice(0, 120), desde: typeof s.updatedAt === 'number' ? s.updatedAt : null };
        if (s.status === 'working' || s.status === 'spawning') saida.push({ ...base, estado: 'trabalhando', motivo: '' });
        else if (s.status === 'waiting_input') saida.push({ ...base, estado: 'pede', motivo: 'pede permissão' });
        else if (s.status === 'errored') saida.push({ ...base, estado: 'parado', motivo: 'parou com erro' });
        // "não começou" só vale para card recente: os antigos dormindo (resumable desde um boot) não contam
        else if (recente(s) && Number(sess.fila || 0) === 0 && Number(sess.ociosoHaMin || 0) >= PARADO_MIN && await semMensagens(agente, s.id)) {
          saida.push({ ...base, estado: 'parado', motivo: 'não começou' });
        }
      }
    }
    cache.set(agente.slug, { em: agora(), lista: saida });
    return saida;
  }

  return { lista };
}

module.exports = { criarAjudantes, PARADO_MIN };
