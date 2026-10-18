'use strict';
/* trilha-tela.js: a parte pura da trilha de comandos, do cartão de permissão e do aviso de fila.

   Sem DOM e sem rede: agrupa os itens da trilha, monta os rótulos e os textos. O desenho e as
   chamadas ficam em conversa.js; aqui fica o que se testa com node:test (web/test/trilha-tela.test.js). */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.DGTrilha = m;
})(this, function () {
  const ehTrilha = m => !!m && m.origin === 'trilha' && !!m.trilha;

  /** Junta os itens da trilha que vêm em sequência (sem mensagem no meio). Devolve [{ trilha:[...] } | { msg }]. */
  function agrupa(lista) {
    const saida = [];
    for (const m of lista) {
      if (ehTrilha(m)) {
        const ultimo = saida[saida.length - 1];
        if (ultimo && ultimo.trilha) ultimo.trilha.push(m);
        else saida.push({ trilha: [m] });
      } else saida.push({ msg: m });
    }
    return saida;
  }

  /** Como agrupa(), mas junta todos os passos de um mesmo pedido (até a próxima fala do dono), mesmo com
      falas do agente no meio. O grupo fica na posição do primeiro passo. (18/10/2026: "Fez 5 passos") */
  function agrupaPorTurno(lista) {
    const saida = [];
    let grupo = null;
    for (const m of lista) {
      if (ehTrilha(m)) {
        if (grupo) grupo.trilha.push(m);
        else { grupo = { trilha: [m] }; saida.push(grupo); }
      } else {
        if (m && m.origin === 'dono') grupo = null;
        saida.push({ msg: m });
      }
    }
    return saida;
  }

  const base = c => String(c || '').split('/').filter(Boolean).pop() || String(c || '');
  /** O que a linha de um passo mostra: o comando ou o alvo de verdade, sem frase fixa. */
  function rotuloPasso(t) {
    if (!t) return '';
    const f = t.ferramenta;
    if (f === 'Bash') return String(t.comando || t.titulo || '').split('\n')[0].trim().slice(0, 160);
    if (f === 'Read' || f === 'Write' || f === 'Edit' || f === 'MultiEdit' || f === 'NotebookEdit') {
      return base(String(t.titulo || '').replace(/^(gravou|editou)\s+/, ''));
    }
    return String(t.titulo || '');
  }
  /** Família do passo, para o ícone. */
  function tipoPasso(f) {
    if (f === 'Bash') return 'terminal';
    if (f === 'Read') return 'ler';
    if (f === 'Write' || f === 'Edit' || f === 'MultiEdit' || f === 'NotebookEdit') return 'editar';
    if (f === 'Grep' || f === 'Glob') return 'buscar';
    if (f === 'WebFetch' || f === 'WebSearch') return 'web';
    if (f === 'Skill') return 'skill';
    if (f === 'Task' || f === 'Agent') return 'ajuda';
    return 'outro';
  }
  /** 8 s, 1 min 12 s, 2 min, 1 h 5 min */
  function duracao(seg) {
    const s = Math.max(0, Math.round(seg));
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return r && m < 10 ? m + ' min ' + r + ' s' : m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  /** Texto da linha fechada de um grupo. */
  function rotuloGrupo(itens) {
    if (itens.length === 1) return 'rodou: ' + itens[0].trilha.titulo;
    const erros = itens.filter(i => i.trilha.erro).length;
    return 'rodou ' + itens.length + ' comandos' + (erros ? ' (' + erros + ' com erro)' : '');
  }

  /** Por que a mensagem está na fila, na frase que o balão mostra. */
  function textoFila(motivo, estaEsperandoPermissao) {
    if (motivo !== 'permissao' && motivo !== 'resposta') return '';
    // se o agente passou a esperar permissão depois do envio, essa é a razão de verdade
    if (estaEsperandoPermissao || motivo === 'permissao') return 'na fila: o agente está esperando a sua permissão';
    return 'na fila: o agente ainda está respondendo a anterior';
  }

  /** O que o cartão de permissão descreve: "Bash: <comando>" ou um aviso de que o detalhe não veio. */
  function descricaoPedido(p) {
    if (!p || !p.titulo) return 'O agente não informou o que quer fazer. Abra o terminal dele para ver.';
    return p.ferramenta + ': ' + (p.comando || p.titulo);
  }

  return { agrupa, agrupaPorTurno, rotuloPasso, tipoPasso, duracao, rotuloGrupo, textoFila, descricaoPedido, ehTrilha };
});
