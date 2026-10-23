'use strict';
// Vigia dos alertas (19/10/2026, pedido do dono): pedido de decisão e entrega viram aviso no celular,
// com o número no ícone do app, mesmo com o app fechado.
//
// Os alertas nascem quando a conversa de um agente é lida (lib/conversa.js chama alertas.observar), e
// até aqui isso só acontecia com alguém com a tela aberta. A vigia lê a conversa de cada agente a cada
// 20 s (a leitura tem cache e não refaz nada sem arquivo novo). O alerta novo chega por aoNovo e vira
// push. Só avisa mensagem recente (15 min): na primeira passada depois de ligar, os alertas antigos
// que ainda não estavam no arquivo não disparam uma enxurrada.

const INTERVALO_MS = 20000;
const RECENTE_S = 15 * 60;

/** O texto da mensagem em uma linha curta: sem blocos de código/visual e sem marcação. */
function resumo(texto, max = 140) {
  const t = String(texto || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
}

function criarVigiaAlertas({ registro, conversa, alertas, push, avisar, log, agora }) {
  // avisar(aviso, tipo): o caminho com as escolhas do dono (lib/boas-vindas.js); sem ele, push direto
  const manda = avisar || ((aviso) => push.enviar(aviso));
  const relogio = agora || (() => Date.now());
  let timer = null;
  let rodando = false;

  function agentes() {
    const est = registro.estado();
    return est && est.ok ? est.agentes : [];
  }
  /** Quantos alertas ainda não vistos, somando todos os agentes: o número do ícone. */
  function pendentes() {
    let n = 0;
    for (const a of agentes()) {
      try { n += alertas(a).listar().length; } catch (e) { log('aviso', `Vigia de alertas: não li os alertas de ${a.nome}: ${e.message}`); }
    }
    return n;
  }

  function aoNovo(agente, item) {
    const m = item && item.mensagem;
    if (!m || !['pedido', 'entrega'].includes(item.tipo)) return;
    if (relogio() / 1000 - (Number(m.ep) || 0) > RECENTE_S) return;
    const nome = agente.nome || agente.slug;
    const aviso = {
      titulo: item.tipo === 'pedido' ? `${nome} precisa da sua decisão` : `${nome}: entrega pronta`,
      corpo: resumo(m.text) || (item.tipo === 'pedido' ? 'Toque para responder.' : 'Toque para ver.'),
      tag: 'alerta-' + item.id,
      url: '/a/' + encodeURIComponent(agente.slug),
      contador: pendentes(),
    };
    manda(aviso, item.tipo).then((r) => {
      if (r && r.falhas && r.falhas.length) log('aviso', `Vigia de alertas: o aviso de ${nome} não chegou a ${r.falhas.length} aparelho(s).`);
    }).catch((e) => log('erro', `Vigia de alertas: não consegui mandar o aviso de ${nome}: ${e.message}`));
  }

  /** Uma passada: lê a conversa de cada agente (o que dispara alertas.observar e, com alerta novo, aoNovo). */
  async function tique() {
    if (rodando) return;
    rodando = true;
    try {
      for (const a of agentes()) {
        try { await conversa.thread(a); } catch (e) { log('aviso', `Vigia de alertas: não li a conversa de ${a.nome}: ${e.message}`); }
      }
    } finally { rodando = false; }
  }

  function iniciar() {
    if (timer) return;
    timer = setInterval(() => { tique().catch((e) => log('erro', `Vigia de alertas: ${e.message}`)); }, INTERVALO_MS);
    if (timer.unref) timer.unref();
  }
  function parar() { if (timer) { clearInterval(timer); timer = null; } }

  return { aoNovo, tique, iniciar, parar, pendentes };
}

module.exports = { criarVigiaAlertas, resumo, RECENTE_S };
