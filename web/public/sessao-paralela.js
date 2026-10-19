'use strict';
/* sessao-paralela.js: "comece outra tarefa enquanto esta roda" (19/10/2026, proposta B do dono).
   Enquanto o agente trabalha, aparece uma dica acima do campo. "Nova sessão" abre uma folha rápida na
   própria conversa: a pessoa escreve o pedido e o agente abre uma sessão paralela (um card da aba
   Sessões do painel, POST <painel>/api/sessoes), sem parar a conversa principal. Depois fica um chip
   com o nome e o estado da sessão, que leva à aba Sessões.

   - O X da dica faz ela não voltar mais (localStorage).
   - Só existe em agente com painel e com a aba Sessões ligada e liberada (GET api/sessoes-config).
   - O nome da sessão sai do começo do pedido.
   A conversa chama DGSessaoParalela.inicia({ agente, atividade, entrada }) quando a tela começa. */
(function () {
  const CHAVE_DICA = 'dgclaw:dica-sessao';
  const ESTADOS = { esperando_voce: 'esperando você', trabalhando: 'trabalhando', concluido: 'concluída',
    parado: 'parada', erro: 'com erro', fechado: 'fechada', arquivado: 'arquivada' };
  const FINAIS = ['concluido', 'fechado', 'erro', 'arquivado'];
  const svg = (d, t) => `<svg viewBox="0 0 24 24" width="${t || 16}" height="${t || 16}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICO_X = svg('<path d="M6 6l12 12M18 6 6 18"/>', 14);
  const ICO_CARD = svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M8 10h8M8 14h5"/>');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const le = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const grava = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* sem armazenamento: vale só nesta visita */ } };

  function nomeDoPedido(t) {
    const linha = String(t).trim().split('\n')[0].replace(/\s+/g, ' ');
    if (linha.length <= 60) return linha;
    const corte = linha.slice(0, 60);
    return (corte.lastIndexOf(' ') > 30 ? corte.slice(0, corte.lastIndexOf(' ')) : corte) + '…';
  }

  function inicia(o) {
    const ag = o && o.agente, atividade = o && o.atividade, entrada = o && o.entrada;
    const linha1 = document.querySelector('.barra .linha1');
    if (!ag || ag.tipo === 'admin' || !ag.tem_painel || !atividade || !linha1) return;
    const painel = (ag.painel_url || '/p/' + encodeURIComponent(ag.id) + '/').replace(/\/?$/, '/');
    const CHAVE_CHIPS = 'dgclaw:sessoes-paralelas:' + ag.id;
    let liberada = null;   // null = ainda não perguntou; depois true/false

    async function confereAba() {
      if (liberada !== null) return liberada;
      try {
        const r = await fetch(painel + 'api/sessoes-config', { credentials: 'same-origin', cache: 'no-store' });
        const d = r.ok ? await r.json() : null;
        liberada = !!(d && d.ligado && d.modo === 'local' && !d.soLeitura);
      } catch (_) { liberada = false; }
      return liberada;
    }

    /* ── dica ── */
    const dica = document.createElement('div');
    dica.id = 'dicaSessao'; dica.hidden = true;
    dica.innerHTML = '<span class="ds-selo">DICA</span><span class="ds-tx">Abra outra tarefa em paralelo</span>' +
      '<button type="button" class="ds-abre">Nova sessão</button>' +
      `<button type="button" class="ds-x" aria-label="Não mostrar mais esta dica" title="Não mostrar mais">${ICO_X}</button>`;
    /* ── folha rápida ── */
    const folha = document.createElement('div');
    folha.id = 'folhaSessao'; folha.hidden = true;
    folha.setAttribute('role', 'dialog'); folha.setAttribute('aria-label', 'Nova sessão em paralelo');
    folha.innerHTML = `<div class="fs-cab">${ICO_CARD}<b>Nova sessão em paralelo</b>` +
      `<button type="button" class="fs-x" aria-label="Fechar" title="Fechar">${ICO_X}</button></div>` +
      `<p class="fs-sub">O ${esc(ag.nome)} abre uma conversa separada para isto e continua a atual.</p>` +
      '<textarea class="fs-pedido" rows="3" maxlength="20000" placeholder="O que ele precisa fazer. A sessão nova não viu esta conversa: diga o que é e onde fica."></textarea>' +
      '<p class="fs-erro" role="alert" hidden></p>' +
      '<div class="fs-acoes"><button type="button" class="fs-ok">Começar</button></div>';
    /* ── chips das sessões criadas ── */
    const chips = document.createElement('div');
    chips.id = 'chipsSessao';
    const barra = linha1.parentElement;
    barra.insertBefore(chips, barra.firstChild);
    linha1.before(dica, folha);

    let abriuNestaVolta = false;   // depois de abrir uma sessão, a dica só volta no próximo trabalho
    function pintaDica() {
      const trabalhando = !atividade.hidden && atividade.classList.contains('trab');
      if (!trabalhando) abriuNestaVolta = false;
      const mostra = trabalhando && !abriuNestaVolta && le(CHAVE_DICA) !== 'fechada' && folha.hidden && liberada === true;
      if (dica.hidden === !mostra) return;
      dica.hidden = !mostra;
    }
    new MutationObserver(() => { if (liberada === null) confereAba().then(pintaDica); else pintaDica(); })
      .observe(atividade, { attributes: true, attributeFilter: ['hidden', 'class'] });

    dica.querySelector('.ds-x').onclick = () => { grava(CHAVE_DICA, 'fechada'); dica.hidden = true; };
    dica.querySelector('.ds-abre').onclick = () => abreFolha();
    const pedido = folha.querySelector('.fs-pedido'), erro = folha.querySelector('.fs-erro'), ok = folha.querySelector('.fs-ok');
    function abreFolha() {
      dica.hidden = true; folha.hidden = false; erro.hidden = true;
      // o que já estava escrito no campo vira o pedido da sessão
      if (entrada && entrada.value.trim() && !pedido.value.trim()) pedido.value = entrada.value.trim();
      pedido.focus();
    }
    function fechaFolha() { folha.hidden = true; pintaDica(); }
    folha.querySelector('.fs-x').onclick = fechaFolha;
    folha.addEventListener('keydown', ev => { if (ev.key === 'Escape') fechaFolha(); });
    ok.onclick = async () => {
      const t = pedido.value.trim();
      if (!t) { erro.textContent = 'Escreva o que a sessão nova precisa fazer.'; erro.hidden = false; return; }
      ok.disabled = true; ok.textContent = 'Abrindo…'; erro.hidden = true;
      try {
        const r = await fetch(painel + 'api/sessoes', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: nomeDoPedido(t), prompt: t, pasta: null }) });
        let d = null; try { d = await r.json(); } catch (_) { d = null; }
        if (!r.ok || !d || d.ok === false) throw new Error((d && (d.erro || d.error)) || ('o painel respondeu ' + r.status));
        const it = d.item || {};
        if (entrada && entrada.value.trim() === t) { entrada.value = ''; entrada.dispatchEvent(new Event('input')); }
        pedido.value = '';
        folha.hidden = true;
        abriuNestaVolta = true;
        guardaChip({ id: it.id, nome: it.nome || nomeDoPedido(t), grupo: it.grupo || 'trabalhando' });
      } catch (e) {
        erro.textContent = 'Não consegui abrir a sessão: ' + e.message + '. Ela pode ter sido criada: confira na aba Sessões antes de tentar de novo.';
        erro.hidden = false;
      } finally {
        ok.disabled = false; ok.textContent = 'Começar';
      }
    };

    // chips: as sessões abertas por aqui nas últimas 12 h, com o estado atualizado a cada 10 s
    function lista() {
      let l = [];
      try { l = JSON.parse(le(CHAVE_CHIPS) || '[]'); } catch (_) { l = []; }
      return Array.isArray(l) ? l.filter(c => c && c.id && Date.now() - (c.em || 0) < 12 * 3600e3) : [];
    }
    function salva(l) { grava(CHAVE_CHIPS, JSON.stringify(l)); }
    function guardaChip(c) {
      if (!c.id) return;
      const l = lista().filter(x => x.id !== c.id);
      l.push(Object.assign({ em: Date.now() }, c));
      salva(l.slice(-4)); pintaChips();
    }
    function pintaChips() {
      const l = lista();
      chips.hidden = !l.length;
      chips.innerHTML = l.map(c => `<span class="cs-chip${FINAIS.includes(c.grupo) ? ' fim' : ''}${c.grupo === 'esperando_voce' ? ' pede' : ''}">` +
        `<a href="${esc(painel)}#aba=sessoes" title="Abrir as Sessões">${ICO_CARD}<span class="cs-tx">Sessão em paralelo · <b>${esc(c.nome)}</b> · ${esc(ESTADOS[c.grupo] || c.grupo)}</span></a>` +
        `<button type="button" class="cs-x" data-cs="${esc(c.id)}" aria-label="Tirar daqui" title="Tirar daqui (a sessão continua nas Sessões)">${ICO_X}</button></span>`).join('');
    }
    chips.addEventListener('click', ev => {
      const x = ev.target.closest('[data-cs]');
      if (x) { salva(lista().filter(c => c.id !== x.dataset.cs)); pintaChips(); }
    });
    async function atualiza() {
      if (document.hidden) return;
      const l = lista();
      let mudou = false;
      for (const c of l.filter(x => !FINAIS.includes(x.grupo))) {
        try {
          const r = await fetch(painel + 'api/sessoes/' + encodeURIComponent(c.id), { credentials: 'same-origin', cache: 'no-store' });
          if (r.status === 404) { c.grupo = 'fechado'; mudou = true; continue; }
          const d = r.ok ? await r.json() : null;
          const g = d && d.item && (d.item.arquivado ? 'arquivado' : d.item.grupo);
          if (g && g !== c.grupo) { c.grupo = g; mudou = true; }
        } catch (_) { /* rede: tenta na próxima volta */ }
      }
      if (mudou) { salva(l); pintaChips(); }
    }
    pintaChips(); atualiza(); setInterval(atualiza, 10000);
    confereAba().then(pintaDica);
  }

  window.DGSessaoParalela = { inicia, nomeDoPedido };
})();
