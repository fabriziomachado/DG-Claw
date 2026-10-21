'use strict';
/* casca.js: o cabeçalho e o menu do agente (os mesmos da tela de Conversa) para as outras telas:
   Mesa, Lembretes, Avisos e o painel do agente (/p/<slug>/).

   Uso: DGCasca.monta({ pagina, titulo, aoTutorial })
     pagina     chave do item ativo do menu: 'mesa', 'lembretes', 'avisos' ou a de uma aba do painel
     titulo     o que aparece sob o nome do agente, no cabeçalho
     aoTutorial função chamada pelo botão Tutorial do cabeçalho (o tutorial da página)
   Depois: DGCasca.ativa(pagina, titulo) troca o item ativo e o título (o painel faz isso a cada aba);
           DGCasca.extras([{chave, ico, nome}]) acrescenta itens do painel que dependem do que está ligado.

   Quem é o agente: o caminho (/p/<slug>/), senão ?a=<slug>, senão o último aberto (localStorage
   'dgclaw:agente', gravado pela Conversa), senão o primeiro agente que não é o Admin.
   O visual mora em casca.css (não depende do chat.css nem do conversa.css); o menu, em menu-lado.js/css. */
/* Tema (18/10/2026): o tema.js decide claro/escuro. As telas da plataforma já o carregam no
   <head>; o painel do agente, se vier de uma versão que ainda não o inclui, recebe aqui. */
(function () {
  if (typeof document === 'undefined' || window.DGTema) return;
  const s = document.createElement('script');
  s.src = '/tema.js';
  (document.head || document.documentElement).appendChild(s);
})();

(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.DGCasca = m;
})(this, function (raiz) {
  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ctx = { caminho, busca, guardado }. Devolve o agente da lista ou null (lista vazia). */
  function escolheAgente(lista, ctx) {
    lista = Array.isArray(lista) ? lista : [];
    const c = ctx || {};
    const doCaminho = /^\/p\/([^/]+)/.exec(c.caminho || '');
    let doParam = null;
    try { doParam = new URLSearchParams(c.busca || '').get('a'); } catch (_) { /* busca ilegível: segue */ }
    let slug = null;
    try { slug = doCaminho ? decodeURIComponent(doCaminho[1]) : null; } catch (_) { /* caminho ilegível: segue */ }
    for (const id of [slug, doParam, c.guardado]) {
      const a = id && lista.find(x => x.id === id);
      if (a) return a;
    }
    return lista.find(a => a.tipo !== 'admin') || lista[0] || null;
  }

  const MARCACAO_CABECALHO =
    '<header data-tour="casca-cabecalho" id="cabecalho">' +
    '<button class="btn ghost" id="btnMenu" type="button" aria-label="Abrir o menu" data-tour="casca-menu"><svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg></button>' +
    '<div class="av" id="av" aria-hidden="true"></div>' +
    '<div class="who" id="who" data-tour="casca-titulo"><b id="nomeAgente">S2 Bot</b><span id="estado"></span></div>' +
    '<a class="btn" id="btnSessoes" href="#" hidden data-tour="casca-sessoes" aria-label="Abrir as Sessões deste agente" title="Sessões de trabalho deste agente"><svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="11.5" rx="2"/><path d="M9 20h6M12 16v4"/></svg> <span class="lbl">Sessões</span></a>' +
    '<button class="btn" id="btnTutorial" type="button" aria-label="Tutorial desta tela" title="Visita guiada desta tela: o que é cada parte e por que está aqui"><svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01"/></svg></button>' +
    '</header>';

  /* A única marcação do menu: a Conversa (conversa.html) e as outras telas (monta) usam esta (menu-lado.js mexe nestes ids). */
  const MARCACAO_MENU =
    '<div id="overlayMenu"></div>' +
    '<aside id="menu" aria-label="Menu do agente">' +
    '<button class="fechar" id="btnFechaMenu" type="button" aria-label="Fechar o menu">✕</button>' +
    '<div class="ml-marca" data-tour="gm-marca">' +
    '<div class="ml-moldura" id="mlMoldura" aria-hidden="true"></div>' +
    '<div class="ml-nome" id="mlNome">S2 Bot</div>' +
    '<div class="ml-sub" id="mlSub"></div>' +
    '<button type="button" class="gm-tut" id="gmTutorial" title="Visita guiada do menu: o que é cada parte e por que está aqui">Tutorial</button>' +
    '<div class="ml-troca" id="mlTroca" data-tour="agentes" hidden>' +
    '<button type="button" id="mlTrocaBtn" aria-haspopup="true" aria-expanded="false"><span>trocar de agente</span><span class="ml-seta" aria-hidden="true">▾</span></button>' +
    '<div class="ml-lista" id="mlLista" role="menu"></div></div></div>' +
    '<nav class="ml-tabs" id="mlTabs" aria-label="Páginas do agente">' +
    '<div data-tour="gm-conversa"><button type="button" class="ml-tab ativo" id="gmIrConversa" aria-current="page"><span class="ml-ico" aria-hidden="true">◔</span>Conversa</button></div>' +
    '<div data-tour="gm-mesa"><a class="ml-tab" href="/mesa"><span class="ml-ico" aria-hidden="true">▦</span>Board</a></div>' +
    '<div id="mlPainel" data-tour="gm-painel" hidden></div></nav>' +
    '<section class="ml-config" id="mlConfig" data-tour="gm-config" aria-label="Configurações"><h3>Configurações</h3>' +
    '<button type="button" class="ml-tab" id="mlInstalar"><span class="ml-ico" aria-hidden="true">⤓</span><span class="ml-tx">Instalar o app<small id="mlInstalarSub"></small></span></button>' +
    '<div class="ml-tema" id="mlTema" role="radiogroup" aria-label="Tema"><span class="ml-ico" aria-hidden="true">◐</span><span class="ml-tema-rot">Tema</span><span class="ml-tema-opcoes"><button type="button" role="radio" data-tema-op="auto">Automático</button><button type="button" role="radio" data-tema-op="claro">Claro</button><button type="button" role="radio" data-tema-op="escuro">Escuro</button></span></div>' +
    '<p class="ml-ajuda" id="mlInstalarAjuda" role="status" hidden></p></section>' +
    '<div class="pe"><div class="conta"><form method="post" action="/sair" id="formSair"><button type="submit" class="sair">Sair</button></form></div></div>' +
    '</aside>';

  /* Cookie não sensível com o último agente aberto: o servidor usa na rota "/" (localStorage ele não enxerga). */
  function guardaAgente(id) {
    if (!id) return;
    try { localStorage.setItem('dgclaw:agente', id); } catch (_) { /* sem armazenamento: o cookie ainda vale */ }
    try {
      document.cookie = 'dgclaw_agente=' + encodeURIComponent(id) + '; Path=/; Max-Age=31536000; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) { console.warn('casca: não consegui gravar o cookie do último agente:', e.message); }
  }

  if (!raiz.document) return { escolheAgente, MARCACAO_CABECALHO, MARCACAO_MENU };

  /* ── Parte com DOM ─────────────────────────────────────────────────────── */
  /* Sem piscar o painel antigo (21/10/2026, o dono via o visual velho por um instante ao recarregar): o painel
     do agente (/p/<slug>/) só chama monta() depois de buscar config e poderes, e até lá o navegador já
     desenhou o layout antigo. Este script roda no <head>: esconde a página até monta() pôr html.casca, e
     mostra assim mesmo depois de 4 s se a casca não montar (erro de rede, script quebrado). */
  if (/^\/p\//.test(location.pathname) && !document.documentElement.classList.contains('casca')) {
    document.documentElement.classList.add('casca-espera');
    setTimeout(() => document.documentElement.classList.remove('casca-espera'), 4000);
  }
  const $ = id => document.getElementById(id);
  const est = { pagina: '', titulo: '', aoTutorial: null, pronto: false, extras: null, agente: null, lista: [] };

  const abreMenu = sim => {
    const menu = $('menu'), ov = $('overlayMenu');
    if (menu) menu.classList.toggle('abre', !!sim);
    if (ov) ov.classList.toggle('abre', !!sim);
  };

  function pintaCabecalho(ag) {
    document.documentElement.style.setProperty('--accent', ag.cor || '#2f9e5e');
    $('nomeAgente').textContent = ag.nome || 'S2 Bot';
    const av = $('av');
    const img = ag.avatar_img || (/^https:\/\//i.test(ag.avatar || '') ? ag.avatar : '');
    av.innerHTML = img ? `<img src="${esc(img)}" alt="">` : esc(ag.avatar || (ag.nome || '?').slice(0, 1));
    av.style.background = ag.cor || '#2f9e5e';
  }

  /* Foto trocada no menu (menu-lado.js): o cabeçalho muda sem recarregar. */
  document.addEventListener('dgavatar', ev => {
    const d = ev.detail || {};
    if (!est.agente || d.id !== est.agente.id) return;
    Object.assign(est.agente, { avatar: d.avatar, avatar_img: d.avatar_img });
    pintaCabecalho(est.agente);
  });

  /* Fileira de agentes (19/10/2026, pedido do dono): o mesmo cabeçalho da Conversa em todas as telas.
     Todos lado a lado com o nome embaixo; o aberto sublinhado e com o nome da página embaixo; anel e
     número quando há aviso não visto; arco girando em quem trabalha. Um toque abre a conversa do agente,
     e o "+" leva ao Admin para criar outro. A da Conversa é desenhada pelo conversa.js; o visual é o
     mesmo (fileira.css). */
  function fotoFileira(a) {
    const img = a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '');
    return img ? `<img src="${esc(img)}" alt="">` : esc(a.avatar || (a.nome || '?').slice(0, 1));
  }
  function montaFileira(lista, atual) {
    const ordem = lista.filter(a => a.tipo === 'admin').concat(lista.filter(a => a.tipo !== 'admin'));
    const admin = lista.find(a => a.tipo === 'admin');
    const nav = document.createElement('nav');
    nav.id = 'fileira';
    nav.setAttribute('aria-label', 'Trocar de agente');
    // "Novo" fica no fim da fileira, depois dos agentes (19/10/2026, pedido do dono)
    nav.innerHTML =
      ordem.map(a => {
        const eh = a.id === atual.id;
        return `<a class="fil${eh ? ' atual' : ''}" href="/a/${encodeURIComponent(a.id)}" data-avt="${esc(a.id)}" style="--arco:${esc(a.cor || '#2f9e5e')}"` +
          ` aria-label="${esc('Conversar com ' + a.nome)}">` +
          `<span class="fil-foto" style="background:${esc(a.cor || '#2f9e5e')}">${fotoFileira(a)}</span>` +
          `<span class="fil-nome">${esc(a.nome)}</span></a>`;
      }).join('') +
      (admin ? `<a class="fil novo" href="/a/${encodeURIComponent(admin.id)}#criar" aria-label="Criar um agente novo">` +
        '<span class="fil-foto"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>' +
        '<span class="fil-nome">Novo</span></a>' : '');
    return nav;
  }
  function pregaFileira(lista, atual) {
    const cab = $('cabecalho');
    if (!cab || lista.length < 2 || $('fileira')) return;
    const nav = montaFileira(lista, atual);
    $('btnMenu').after(nav);
    cab.classList.add('com-fileira');
    const at = nav.querySelector('.atual');
    if (at) {
      $('estado').classList.add('fil-estado');
      at.appendChild($('estado'));
      if (at.scrollIntoView) at.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    const outros = lista.filter(a => a.id !== atual.id);
    const doAgente = id => nav.querySelector('[data-avt="' + CSS.escape(id) + '"]');
    // avisos não vistos de cada outro agente: anel e número (amarelo se algum pede decisão)
    async function avisos() {
      if (document.hidden) return;
      for (const a of outros) {
        let alertas = [];
        try {
          const r = await fetch('/api/v1/agents/' + encodeURIComponent(a.id) + '/alertas', { credentials: 'same-origin', cache: 'no-store' });
          if (!r.ok) continue;
          alertas = ((await r.json()) || {}).alertas || [];
        } catch (_) { continue; }
        const el = doAgente(a.id);
        if (!el) continue;
        let b = el.querySelector('.fil-badge');
        el.classList.toggle('aviso', alertas.length > 0);
        el.classList.toggle('pede', alertas.some(x => x.tipo === 'pedido'));
        if (!alertas.length) { if (b) b.remove(); continue; }
        if (!b) { b = document.createElement('span'); b.className = 'fil-badge'; el.appendChild(b); }
        b.textContent = alertas.length > 9 ? '9+' : String(alertas.length);
      }
    }
    // quem está trabalhando: arco girando na foto e "trabalhando" embaixo do nome (o aberto mantém o nome da página)
    async function trabalho() {
      if (document.hidden) return;
      let d = null;
      try {
        const r = await fetch('/api/v1/atividade', { credentials: 'same-origin', cache: 'no-store' });
        if (r.ok) d = await r.json();
      } catch (_) { return; }
      if (!d || !d.agentes) return;
      if (raiz.DGAjudantes) raiz.DGAjudantes.pinta(d);   // selo dos ajudantes na foto (ajudantes.js)
      for (const a of lista) {
        const el = doAgente(a.id);
        const sim = (d.agentes[a.id] || {}).estado === 'trabalhando';
        if (!el || el.classList.contains('trab') === sim) continue;
        el.classList.toggle('trab', sim);
        if (a.id === atual.id) continue;
        let e = el.querySelector('.fil-estado');
        if (sim && !e) { e = document.createElement('span'); e.className = 'fil-estado'; e.textContent = 'trabalhando'; el.appendChild(e); }
        else if (!sim && e) e.remove();
      }
    }
    avisos(); setInterval(avisos, 30000);
    // os ajudantes (ajudantes.js) vêm junto da casca: as telas não precisam carregar mais um script
    if (!raiz.DGAjudantes && !document.querySelector('script[src="/ajudantes.js"]')) {
      const sc = document.createElement('script'); sc.src = '/ajudantes.js'; document.head.appendChild(sc);
    }
    trabalho(); setInterval(trabalho, 6000);
    document.addEventListener('visibilitychange', () => { avisos(); trabalho(); });
    document.addEventListener('dgavatar', ev => {
      const d = ev.detail || {};
      const el = d.id && doAgente(d.id);
      if (el) el.querySelector('.fil-foto').innerHTML = fotoFileira(Object.assign({}, lista.find(a => a.id === d.id) || {}, d));
    });
  }

  function pintaTitulo() {
    const e = $('estado');
    if (e) e.textContent = est.titulo || '';
  }

  function comTour(fn) {
    if (raiz.DGTour) { fn(); return; }
    const s = document.createElement('script');
    s.src = '/tour.js';
    s.onload = fn;
    s.onerror = () => alert('A visita guiada não carregou. Recarregue a página e tente de novo.');
    document.head.appendChild(s);
  }

  function passosCasca() {
    const nome = (est.agente && est.agente.nome) || 'o agente';
    return [
      { alvo: '#cabecalho', antes: () => abreMenu(false), titulo: 'O cabeçalho',
        oque: 'A foto e o nome do agente, e embaixo o nome da página em que você está. O botão Tutorial, aqui no cabeçalho, explica a página.',
        como: 'O cabeçalho é o mesmo em todas as telas: Conversa, Board, Lembretes e as páginas do painel. A cor e a foto são as de ' + nome + '.',
        porque: 'Assim você sabe de quem é a tela e nunca fica sem saber onde está.' },
      ...($('btnSessoes') && !$('btnSessoes').hidden ? [{ alvo: '#btnSessoes', antes: () => abreMenu(false), titulo: 'O botão Sessões',
        oque: 'Um atalho para as sessões de trabalho de ' + nome + ': os cards que andam em paralelo com a conversa principal. Uma bolinha vermelha avisa quando alguma espera uma decisão sua.',
        como: 'Toque nele e a tela de Sessões abre dentro do painel do agente, na mesma janela. No celular o texto some e fica só o ícone 🖥.',
        porque: 'É o mini-Bunker do agente: você acompanha e cria trabalhos longos sem sair procurando no menu.' }] : []),
      { alvo: '#btnMenu', antes: () => abreMenu(false), titulo: 'O botão do menu',
        oque: 'No celular, o botão ☰ abre o menu do agente. No computador ele não aparece, porque o menu já fica fixo à esquerda.',
        como: 'Toque nele para ir a outra página, trocar de agente ou sair. Toque fora do menu, no ✕ ou na tecla Esc para fechar.',
        porque: 'Mantém a tela limpa: o que não é a página atual fica guardado no menu.' },
      ...raiz.DGMenuLado.passosMenu({ nome, abre: () => abreMenu(true), fecha: () => abreMenu(false),
        comTroca: est.lista.filter(a => a.tipo === 'admin').concat(est.lista.filter(a => a.tipo !== 'admin')).length > 1,
        naConversa: false }),
    ];
  }

  function tutorialMenu() {
    comTour(() => raiz.DGTour.inicia({ passos: passosCasca(), aoFechar: () => abreMenu(false) }));
  }

  function tutorialPagina() {
    if (typeof est.aoTutorial === 'function') {
      try { est.aoTutorial(); } catch (e) { console.warn('casca: o tutorial da página falhou:', e); }
    } else tutorialMenu();
  }

  async function buscaLista() {
    const r = await fetch('/api/v1/agents', { cache: 'no-store', credentials: 'same-origin' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || d.ok === false) throw new Error((d && d.erro) || ('a API respondeu ' + r.status));
    return Array.isArray(d.agentes) ? d.agentes : [];
  }

  /* A Conversa tem o próprio cabeçalho, mas o menu é este: troca o ponto <div id="menuPonto"> do conversa.html pela marcação. */
  function injetaMenu(idPonto) {
    const ponto = $(idPonto || 'menuPonto');
    if (!ponto) { console.error('casca: o conversa.html não tem o ponto de montagem do menu (#' + (idPonto || 'menuPonto') + '); o menu não foi criado.'); return; }
    ponto.insertAdjacentHTML('beforebegin', MARCACAO_MENU);
    ponto.remove();
  }

  function monta(opcoes) {
    const o = opcoes || {};
    est.pagina = o.pagina || '';
    est.titulo = o.titulo || '';
    est.aoTutorial = o.aoTutorial || null;
    if (!document.body) { document.addEventListener('DOMContentLoaded', () => monta(o)); return Promise.resolve(); }
    if ($('cabecalho')) return Promise.resolve();   // já montada
    document.documentElement.classList.add('casca');
    document.body.insertAdjacentHTML('afterbegin', MARCACAO_CABECALHO + MARCACAO_MENU);
    document.documentElement.classList.remove('casca-espera');
    pintaTitulo();
    $('btnMenu').onclick = () => abreMenu(true);
    $('btnFechaMenu').onclick = () => abreMenu(false);
    $('overlayMenu').onclick = () => abreMenu(false);
    $('btnTutorial').onclick = tutorialPagina;
    $('gmTutorial').onclick = tutorialMenu;
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && $('menu').classList.contains('abre') && !$('tourCaixa')) abreMenu(false);
    });

    let guardado = null;
    try { guardado = localStorage.getItem('dgclaw:agente'); } catch (_) { /* sem armazenamento */ }
    const ctx = { caminho: location.pathname, busca: location.search, guardado };
    return buscaLista().then(lista => ({ lista, erro: null }), e => ({ lista: [], erro: e.message }))
      .then(({ lista, erro }) => {
        est.lista = lista;
        let ag = escolheAgente(lista, ctx);
        const slug = (/^\/p\/([^/]+)/.exec(location.pathname) || [])[1] || new URLSearchParams(location.search).get('a') || guardado || '';
        if (!ag) ag = { id: erro ? slug : '', nome: 'S2 Bot', cor: '#2f9e5e', avatar: 'D' };
        est.agente = ag;
        pintaCabecalho(ag);
        if (!erro && ag.id) pregaFileira(lista, ag);
        if (!erro) guardaAgente(ag.id);
        if (!raiz.DGMenuLado) {
          console.warn('casca: menu-lado.js não carregou; o menu fica sem conteúdo. Carregue /menu-lado.js antes de /casca.js.');
          return;
        }
        raiz.DGMenuLado.inicia({
          agente: ag, agentes: erro ? undefined : lista, erroLista: erro ? 'o servidor respondeu: ' + erro : undefined,
          fecha: () => abreMenu(false), ativo: est.pagina, extras: est.extras || undefined,
        });
        est.pronto = true;
        raiz.DGMenuLado.marca(est.pagina);
      });
  }

  /* Troca o item ativo e o título (o painel chama a cada aba). */
  function ativa(pagina, titulo) {
    est.pagina = pagina || '';
    if (titulo != null) est.titulo = titulo;
    pintaTitulo();
    if (est.pronto && raiz.DGMenuLado) raiz.DGMenuLado.marca(est.pagina);
  }

  /* Itens do painel que dependem do que está ligado (Sessões, Posts, Seguidores, Reuniões). */
  function extras(lista) {
    est.extras = lista;
    if (est.pronto && raiz.DGMenuLado) raiz.DGMenuLado.extras(lista);
  }

  return { monta, ativa, extras, escolheAgente, abreMenu, tutorialMenu, injetaMenu, guardaAgente };
});
