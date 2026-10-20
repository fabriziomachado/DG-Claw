'use strict';
// Caixa de entrada (19/10/2026, pedido do dono): tudo que espera o dono, de todos os agentes, num
// lugar só. Esta rota junta os alertas não vistos (pedidos de decisão e entregas) de cada agente;
// os lembretes que estão tocando vêm da rota dos lembretes (campo "insistindo") e a tela junta os dois.
//
// GET /api/v1/caixa -> { ok, itens: [{ id, tipo, agente, ep, mensagem_id, texto, pergunta, opcoes }], total }
// Responder ou dispensar usa as rotas que já existem: POST /api/v1/agents/<slug>/send e
// POST /api/v1/agents/<slug>/alertas/<id>/visto.

const H = require('./http');
const { resumo } = require('./vigia-alertas');

/** O primeiro cartão de escolha (```dgui {"tipo":"escolha"}) da mensagem: { pergunta, opcoes } ou null. */
function escolhaDe(texto) {
  const rx = /```dgui\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = rx.exec(String(texto || '')))) {
    let d;
    try { d = JSON.parse(m[1]); } catch (_) { continue; }
    if (!d || d.tipo !== 'escolha' || !Array.isArray(d.opcoes)) continue;
    const opcoes = d.opcoes.slice(0, 5).map((o) => (typeof o === 'string' ? { texto: o } : o || {}))
      .filter((o) => typeof o.texto === 'string' && o.texto.trim())
      .map((o) => ({ texto: o.texto.slice(0, 200), detalhe: typeof o.detalhe === 'string' ? o.detalhe.slice(0, 200) : '', recomendada: !!o.recomendada }));
    if (opcoes.length) return { pergunta: typeof d.pergunta === 'string' ? d.pergunta.slice(0, 300) : '', opcoes };
  }
  return null;
}

function criarCaixaEntrada({ registro, alertas, corteDe, log }) {
  function itens() {
    const est = registro.estado();
    const lista = [];
    for (const agente of (est && est.ok ? est.agentes : [])) {
      let loja, pendentes;
      try {
        loja = alertas(agente);
        const corte = corteDe ? corteDe(agente.slug) : 0;
        pendentes = loja.listar().filter((a) => a.ep > corte);
      } catch (e) {
        log('aviso', `Caixa de entrada: não li os alertas de ${agente.nome}: ${e.message}`);
        continue;
      }
      for (const a of pendentes) {
        const m = loja.mensagem(a.id) || {};
        const esc = a.tipo === 'pedido' ? escolhaDe(m.text) : null;
        lista.push({
          id: a.id, tipo: a.tipo, agente: agente.slug, ep: a.ep, mensagem_id: a.mensagem_id,
          texto: resumo(m.text, 300), pergunta: esc ? esc.pergunta : '', opcoes: esc ? esc.opcoes : [],
        });
      }
    }
    // pedidos primeiro (precisam de você), depois entregas; dentro de cada um, o mais novo no alto
    return lista.sort((x, y) => (x.tipo === y.tipo ? y.ep - x.ep : x.tipo === 'pedido' ? -1 : 1));
  }

  async function rotas(req, res, url, sessao) {
    if (url.pathname !== '/api/v1/caixa') return false;
    // a caixa é do dono: um agente, pela caixa dele, não lê os pedidos dos outros
    if (!sessao || sessao.via === 'caixa') { H.erroJson(res, 403, 'A caixa de entrada é só do dono, pelo login do painel.'); return true; }
    if (req.method !== 'GET') { H.erroJson(res, 405, 'A caixa de entrada só aceita GET. Para responder, use /api/v1/agents/<slug>/send.'); return true; }
    try {
      const l = itens();
      H.enviaJson(res, 200, { ok: true, itens: l, total: l.length });
    } catch (e) {
      log('erro', `Caixa de entrada: ${e.message}`);
      H.erroJson(res, 503, `Não consegui montar a caixa de entrada: ${e.message}. Tente de novo.`);
    }
    return true;
  }

  return { itens, rotas };
}

module.exports = { criarCaixaEntrada, escolhaDe };
