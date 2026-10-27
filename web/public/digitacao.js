'use strict';
/* digitacao.js: a resposta nova do agente aparece como digitação (26/10/2026, pedido do dono).

   O agente entrega a mensagem inteira de uma vez (ele escreve no terminal e manda pronta), então
   isto é só o visual: quando um balão novo do agente chega no fim da conversa, o texto é revelado
   em 0,35 a 1,8 s. Não mexe no conversa.js: observa o #wrap.
   - Só mensagem que chegou com a tela aberta: o que já estava (cache, primeira carga, histórico
     subindo, pulo da busca) aparece inteiro.
   - Tabela, código, gráfico, imagem e visual aparecem inteiros quando a vez deles chega.
   - Tocar no balão mostra tudo na hora. Com "reduzir movimento" no aparelho, não anima.
   - Com o modo escondido (olhinho) ligado, não anima: o sigilo.js troca os mesmos nós de texto,
     e a digitação poderia repor um nome antes de ele ser escondido. */
(function () {
  const wrap = document.getElementById('wrap');
  if (!wrap || typeof MutationObserver !== 'function') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const MS_POR_LETRA = 6, MIN_MS = 350, MAX_MS = 1800, PESO_BLOCO = 40;
  const ASSENTA_MS = 4000;     // os primeiros segundos são a carga da conversa: nada anima
  const MAX_NOVOS = 3;         // muitas linhas de uma vez é histórico ou busca, não resposta nova
  const INTEIROS = 'table,pre,code,img,svg,iframe,video,audio,canvas,button,[class^="dgui"],[class*=" dgui"],.visq,.mid,.cartaoarq';

  const css = document.createElement('style');
  css.textContent = '.dig-oculto{visibility:hidden}.row.digitando>:not(.bub){visibility:hidden}';
  document.head.appendChild(css);
  const sigiloLigado = () => document.body.classList.contains('sigilo') || document.documentElement.classList.contains('sigilo');

  const vistas = new Set();
  let inicio = 0;
  const idDe = el => (el && el.dataset && el.dataset.msg) || '';
  const ehResposta = el => el.classList && el.classList.contains('row') && el.classList.contains('her') &&
    !el.classList.contains('trilha') && !el.classList.contains('comando') && !el.classList.contains('men') &&
    !el.classList.contains('vis');

  function marcaTodas() { for (const el of wrap.children) { const id = idDe(el); if (id) vistas.add(id); } }

  new MutationObserver(lotes => {
    const agora = Date.now();
    if (!inicio && wrap.children.length) inicio = agora;
    const novos = [];
    for (const l of lotes) for (const el of l.addedNodes) {
      const id = idDe(el);
      if (!id || vistas.has(id)) continue;
      vistas.add(id);
      novos.push(el);
    }
    if (!novos.length || agora - inicio < ASSENTA_MS || novos.length > MAX_NOVOS) return;
    for (const el of novos) {
      // só no fim da conversa: o que entra no meio ou no topo é histórico
      let depois = el.nextElementSibling, noFim = true;
      while (depois) { if (!novos.includes(depois) && idDe(depois)) { noFim = false; break; } depois = depois.nextElementSibling; }
      if (noFim && ehResposta(el) && !sigiloLigado()) digita(el);
    }
  }).observe(wrap, { childList: true });
  marcaTodas();

  function digita(row) {
    const bub = row.querySelector(':scope > .bub');
    if (!bub) return;
    // em ordem de leitura: pedaços de texto (revelados letra a letra) e blocos inteiros
    const unidades = [];
    const anda = no => {
      for (const f of Array.from(no.childNodes)) {
        if (f.nodeType === 3) { if (f.nodeValue.trim()) unidades.push({ texto: f, cheio: f.nodeValue }); }
        else if (f.nodeType === 1) {
          if (f.matches(INTEIROS)) unidades.push({ bloco: f });
          else anda(f);
        }
      }
    };
    anda(bub);
    const total = unidades.reduce((s, u) => s + (u.bloco ? PESO_BLOCO : u.cheio.length), 0);
    if (total < 12) return;
    const dur = Math.max(MIN_MS, Math.min(MAX_MS, total * MS_POR_LETRA));
    // tudo começa escondido; cada parte aparece quando a vez dela chega
    const topo = Array.from(bub.children);
    for (const u of unidades) { if (u.texto) u.texto.nodeValue = ''; else u.bloco.classList.add('dig-oculto'); }
    for (const t of topo) t.classList.add('dig-oculto');
    row.classList.add('digitando');
    const mostraTopo = no => { for (const t of topo) if (t === no || t.contains(no)) t.classList.remove('dig-oculto'); };
    let i = 0, usado = 0, t0 = 0, raf = 0, acabou = false;
    const termina = () => {
      if (acabou) return;
      acabou = true;
      cancelAnimationFrame(raf);
      for (const u of unidades) { if (u.texto) u.texto.nodeValue = u.cheio; else u.bloco.classList.remove('dig-oculto'); }
      for (const t of topo) t.classList.remove('dig-oculto');
      row.classList.remove('digitando');
      bub.removeEventListener('click', termina, true);
    };
    bub.addEventListener('click', termina, true);
    const passo = t => {
      if (!row.isConnected) return termina();   // o render refez o balão: o nó novo já vem inteiro
      if (!t0) t0 = t;
      const alvo = Math.min(total, Math.ceil(total * (t - t0) / dur));
      while (i < unidades.length && usado < alvo) {
        const u = unidades[i];
        const custo = u.bloco ? PESO_BLOCO : u.cheio.length;
        const no = u.bloco || u.texto;
        mostraTopo(no);
        if (u.bloco) { u.bloco.classList.remove('dig-oculto'); usado += custo; i++; continue; }
        const falta = alvo - usado, ja = u.texto.nodeValue.length;
        const quer = Math.min(u.cheio.length, ja + falta);
        u.texto.nodeValue = u.cheio.slice(0, quer);
        usado += quer - ja;
        if (quer >= u.cheio.length) i++; else break;
      }
      if (i >= unidades.length) return termina();
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
  }
})();
