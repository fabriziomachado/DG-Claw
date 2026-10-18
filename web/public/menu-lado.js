'use strict';
/* menu-lado.js: o menu do agente na tela de conversa (gaveta no celular, barra fixa no computador).

   Mostra a foto do agente, o seletor para trocar de agente (cada item com a PRÓPRIA foto), a
   Conversa, as páginas do painel daquele agente e a seção Configurações (instalar o app).
   As partes que só montam texto (itemAgente, linksPainel, instrucaoInstalar) ficam fora do DOM e
   têm teste em web/test/menu-lado.test.js. Quem chama é o conversa.js, que já buscou a lista de
   /api/v1/agents: aqui ela não é buscada de novo, a não ser para o botão "recarregar". */
(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.DGMenuLado = m;
})(this, function (raiz) {
  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* chave = o que vai depois de #aba= (o painel abre a aba por ela) */
  const ABAS_PAINEL = [
    ['status', '◉', 'Status'], ['skills', '✦', 'Skills'], ['rotinas', '↻', 'Rotinas'],
    ['cofre', '⚿', 'Cofre (chaves)'], ['arquivos', '▢', 'Pasta do agente'],
    ['memory', '▤', 'Memória'], ['operations', '⚙', 'Operações'], ['costs', '◇', 'Custos'],
    ['como', '◎', 'Como funciona'], ['identity', '◈', 'Identidade'], ['personality', '◐', 'Personalidade'],
    ['apps', '▨', 'Apps'], ['socorro', '✚', 'Socorro'],
  ];


  /* Entrada fixa do menu: a tela de lembretes (vale para qualquer agente). */
  const LINK_LEMBRETES = { nome: 'Lembretes', ico: '⏰', href: '/lembretes' };
  /* Entrada fixa: as integrações de todos os agentes (conectores, plugins, skills, chaves, canais). */
  const LINK_INTEGRACOES = { nome: 'Integrações', ico: '⧉', href: '/integracoes' };

  /* Páginas fora do painel (Mesa, Lembretes) não têm o agente no caminho: levam ?a=<slug> para a
     tela saber de quem é o menu. */
  function comAgente(href, id) {
    if (!id) return href;
    return href + (href.indexOf('?') >= 0 ? '&' : '?') + 'a=' + encodeURIComponent(id);
  }

  /* Qual item do menu o link representa: 'mesa', 'lembretes', a chave de #aba=... ou '' (outro). */
  function chaveDoHref(href) {
    const h = String(href || '');
    const aba = /#aba=([^&]*)/.exec(h);
    if (aba) return decodeURIComponent(aba[1]);
    const caminho = h.split(/[?#]/)[0].replace(/\/+$/, '');
    if (caminho === '/mesa') return 'mesa';
    if (caminho === '/lembretes') return 'lembretes';
    if (caminho === '/integracoes') return 'integracoes';
    if (/^\/a\/[^/]+$/.test(caminho)) return 'conversa';
    return '';
  }

  /* Itens extras do painel que dependem do que está ligado (Sessões e os poderes). Cada um: { chave, ico, nome }. */
  function linksExtras(a, extras) {
    if (!a || !a.tem_painel || !Array.isArray(extras)) return [];
    const base = a.painel_url || ('/p/' + encodeURIComponent(a.id) + '/');
    return extras.filter(x => x && x.chave && x.nome).map(x => ({ nome: x.nome, ico: x.ico || '•', href: base + '#aba=' + x.chave }));
  }

  /* Passos da visita guiada do menu, os mesmos na Conversa e nas outras telas.
     o = { nome, abre(), fecha(), comTroca, naConversa } */
  function passosMenu(o) {
    const nome = o.nome;
    const abre = o.abre || function () {};
    const passos = [{
      alvo: '#mlMoldura', antes: abre, titulo: 'O menu do agente',
      oque: 'A foto, o nome e as páginas de ' + nome + ', sempre no lado esquerdo. No computador ele fica aberto o tempo todo; no celular abre pelo botão ☰.',
      como: (o.naConversa ? 'O item Conversa (esta tela) fica no alto.' : 'O item Conversa, no alto, leva de volta ao chat.') +
        ' Os outros itens levam à Mesa, aos Lembretes e às páginas do painel dele. Tocar na foto abre a troca de foto. O Tutorial, aqui em cima, repete esta visita.',
      porque: 'Assim a conversa e o painel de cada agente ficam no mesmo lugar, sem link escondido.',
    }];
    if (o.comTroca) {
      passos.push({
        alvo: '#mlTroca', antes: abre, titulo: 'Trocar de agente',
        oque: 'Um seletor com todos os agentes que trabalham para você, cada um com a sua foto. O Admin vem primeiro, com o selo "admin"; o agente em que você está aparece marcado com "aqui".',
        como: 'Toque em "trocar de agente" e escolha um da lista: a conversa e o menu passam a ser dele. Cada agente tem a própria conversa e a própria memória.',
        porque: 'Você escolhe com quem falar sem sair desta tela. O Admin cuida da instalação e dos ajustes; os outros fazem o trabalho do dia a dia.',
      });
    }
    return passos;
  }

  /* A foto vem SEMPRE do próprio agente do item. Sem foto, círculo com a cor dele e a letra. */
  function fotoDe(a) {
    const img = a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '');
    if (img) return `<img src="${esc(img)}" alt="">`;
    return esc(a.avatar || (a.nome || '?').slice(0, 1));
  }

  function itemAgente(a, atualId) {
    const aqui = a.id === atualId;
    const sub = a.subtitulo || [a.provedor, a.modelo].filter(Boolean).join(' · ');
    return `<a class="ml-ag${aqui ? ' atual' : ''}" role="menuitem" href="/a/${encodeURIComponent(a.id)}"` +
      `${aqui ? ' aria-current="page"' : ''}>` +
      `<span class="ml-mini" style="background:${esc(a.cor || '#2f9e5e')}">${fotoDe(a)}</span>` +
      `<span class="ml-quem"><b>${esc(a.nome)}</b><small>${esc(sub)}</small></span>` +
      `${aqui ? '<span class="ml-aqui">aqui</span>' : ''}</a>`;
  }

  function linksPainel(a) {
    if (!a || !a.tem_painel) return [];
    const base = a.painel_url || ('/p/' + encodeURIComponent(a.id) + '/');
    return ABAS_PAINEL.map(([chave, ico, nome]) => ({ nome, ico, href: base + '#aba=' + chave }));
  }

  /* env = { standalone, ios, promptGuardado }. Devolve { tipo, texto }:
     'instalado' (esconde o item), 'prompt' (chama o prompt do navegador), 'ios' ou 'sem' (só explica). */
  function instrucaoInstalar(env) {
    if (env.standalone) return { tipo: 'instalado', texto: '' };
    if (env.promptGuardado) return { tipo: 'prompt', texto: '' };
    if (env.ios) {
      return { tipo: 'ios', texto: 'Toque em Compartilhar (o quadrado com a seta para cima) e depois em Adicionar à Tela de Início.' };
    }
    return { tipo: 'sem', texto: 'Este navegador não oferece a instalação por aqui. No Chrome ou no Edge, abra o menu do navegador e procure Instalar app. No Firefox para computador, o recurso não existe.' };
  }

  /* Recorte quadrado pelo centro de uma imagem w x h (a foto do agente é sempre um círculo). */
  function recorteQuadrado(w, h) {
    const lado = Math.max(1, Math.min(w, h));
    return { sx: Math.floor((w - lado) / 2), sy: Math.floor((h - lado) / 2), lado };
  }

  /* O que a escolha do arquivo diz antes de subir: '' (segue) ou a frase de erro. */
  function problemaArquivo(f) {
    if (!f) return 'Nenhuma foto escolhida.';
    if (f.type && !/^image\//.test(f.type)) return 'Esse arquivo não é uma foto. Escolha uma foto PNG, JPEG ou WebP.';
    if (/svg/i.test(f.type || '') || /\.svg$/i.test(f.name || '')) return 'Desenho SVG não serve como foto. Escolha uma foto PNG, JPEG ou WebP.';
    if (f.size > 40 * 1024 * 1024) return 'Essa foto é grande demais. Escolha uma de até 40 MB (ela é reduzida antes de enviar).';
    return '';
  }

  if (!raiz.document) return { ABAS_PAINEL, LINK_LEMBRETES, itemAgente, linksPainel, linksExtras, comAgente, chaveDoHref, passosMenu, instrucaoInstalar, recorteQuadrado, problemaArquivo };

  /* ── Parte com DOM ─────────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  let promptGuardado = null;
  // O Chrome dispara isto uma vez, cedo; sem guardar aqui o toque no item não teria o que chamar.
  window.addEventListener('beforeinstallprompt', ev => {
    ev.preventDefault();
    promptGuardado = ev;
    pintaInstalar();
  });
  window.addEventListener('appinstalled', () => { promptGuardado = null; pintaInstalar(); });

  const ehStandalone = () => navigator.standalone === true ||
    (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const ehIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function pintaInstalar() {
    const sec = $('mlConfig');
    if (!sec) return;
    const r = instrucaoInstalar({ standalone: ehStandalone(), ios: ehIos(), promptGuardado: !!promptGuardado });
    // App já instalado: some só o "Instalar o app"; a seção fica, porque o Tema também está nela
    const instalado = r.tipo === 'instalado';
    $('mlInstalar').hidden = instalado;
    if (instalado) mostraCaixa('');
    sec.hidden = instalado && !document.getElementById('mlTema');
    $('mlInstalarSub').textContent = r.tipo === 'prompt' ? 'atalho na tela, abre sem barra do navegador'
      : 'como colocar na tela inicial';
  }

  function mostraCaixa(texto) {
    const c = $('mlInstalarAjuda');
    c.textContent = texto;
    c.hidden = !texto;
  }

  async function aoInstalar() {
    const r = instrucaoInstalar({ standalone: ehStandalone(), ios: ehIos(), promptGuardado: !!promptGuardado });
    if (r.tipo !== 'prompt') { mostraCaixa($('mlInstalarAjuda').hidden ? r.texto : ''); return; }
    const p = promptGuardado;
    promptGuardado = null;
    try {
      await p.prompt();
      const esc_ = await p.userChoice;
      mostraCaixa(esc_ && esc_.outcome === 'accepted' ? '' : 'Tudo bem. Se mudar de ideia, o item continua aqui no menu.');
    } catch (e) {
      console.warn('menu-lado: o navegador recusou abrir a instalação:', e.message);
      mostraCaixa('O navegador não abriu a instalação (' + e.message + '). Tente pelo menu do navegador, em Instalar app.');
    }
    pintaInstalar();
  }

  function pintaLista(ag, lista, erro) {
    const caixa = $('mlLista'), troca = $('mlTroca');
    if (erro) {
      troca.hidden = false;
      caixa.innerHTML = `<div class="ml-vazio" role="alert">Não consegui listar os agentes: ${esc(erro)}. ` +
        '<button type="button" id="mlRecarrega">Recarregar a lista</button></div>';
      $('mlRecarrega').onclick = recarrega.bind(null, ag);
      return;
    }
    // sem outro agente para onde ir, o seletor só atrapalha
    troca.hidden = lista.length < 2;
    const ordem = lista.filter(a => a.tipo === 'admin').concat(lista.filter(a => a.tipo !== 'admin'));
    caixa.innerHTML = ordem.map(a => itemAgente(a, ag.id)).join('');
  }

  /* silencioso: nas buscas automáticas uma falha de rede passageira não troca a lista por um erro. */
  async function recarrega(ag, silencioso) {
    try {
      const r = await fetch('/api/v1/agents', { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || d.ok === false) throw new Error((d && d.erro) || ('a API respondeu ' + r.status));
      pintaLista(ag, Array.isArray(d.agentes) ? d.agentes : [], null);
    } catch (e) {
      if (silencioso) console.warn('menu-lado: não consegui atualizar a lista de agentes (mantive a anterior):', e.message);
      else pintaLista(ag, [], e.message);
    }
  }

  let agenteAtual = null;

  /* Marca o item da página aberta (.ativo e aria-current). chave: 'conversa', 'mesa', 'lembretes' ou a de uma aba do painel.
     Chave sem item no menu (ex.: 'avisos') não marca nenhum. */
  let chaveAtiva = '';
  function marca(chave) {
    chaveAtiva = chave;
    document.querySelectorAll('#mlTabs .ml-tab').forEach(el => {
      const ativo = !!chave && chaveDoHref(el.getAttribute('href') || (el.id === 'gmIrConversa' ? '/a/x' : '')) === chave;
      el.classList.toggle('ativo', ativo);
      if (ativo) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
  }

  /* Troca os itens extras do painel (Sessões, Posts...): chamado de novo quando o que está ligado muda. */
  function extras(lista) {
    const painel = $('mlPainel');
    if (!painel || !agenteAtual) return;
    painel.querySelectorAll('[data-extra]').forEach(el => el.remove());
    const links = linksExtras(agenteAtual, lista);
    painel.insertAdjacentHTML('beforeend', links.map(l => `<a class="ml-tab" data-extra="1" href="${esc(l.href)}">` +
      `<span class="ml-ico" aria-hidden="true">${esc(l.ico)}</span>${esc(l.nome)}</a>`).join(''));
    painel.hidden = !painel.children.length;
    marca(chaveAtiva);
  }

  /* opcoes: { agente, agentes (a lista já carregada), fecha() (fecha a gaveta), ativo (chave da página aberta; padrão 'conversa'), extras (itens extras do painel), erroLista (texto: a lista de agentes falhou) } */
  function inicia(opcoes) {
    const ag = opcoes.agente;
    pintaMoldura(ag);
    $('mlNome').textContent = ag.nome;
    $('mlSub').textContent = ag.tipo === 'admin' ? 'administrador do servidor'
      : (ag.subtitulo || [ag.provedor, ag.modelo].filter(Boolean).join(' · '));
    document.documentElement.classList.add('ml-ativo');

    const troca = $('mlTroca'), btn = $('mlTrocaBtn');
    const abre = sim => { troca.classList.toggle('aberto', sim); btn.setAttribute('aria-expanded', String(sim)); };
    btn.onclick = () => abre(!troca.classList.contains('aberto'));
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && troca.classList.contains('aberto')) { abre(false); ev.stopPropagation(); }
    }, true);
    if (opcoes.erroLista) { pintaLista(ag, [], opcoes.erroLista); abre(true); }   // a lista não veio: o erro aparece já aberto
    else if (Array.isArray(opcoes.agentes)) pintaLista(ag, opcoes.agentes, null);
    else recarrega(ag);
    /* Agente criado ou apagado em outra aba aparece sem recarregar a página: a cada 30 s e quando a aba volta a ficar visível. */
    const atualiza = () => { if (document.visibilityState === 'visible') recarrega(ag, true); };
    document.addEventListener('visibilitychange', atualiza);
    setInterval(atualiza, 30000);

    const painel = $('mlPainel'), links = linksPainel(ag);
    painel.innerHTML = links.map(l => `<a class="ml-tab" href="${esc(l.href)}">` +
      `<span class="ml-ico" aria-hidden="true">${l.ico}</span>${esc(l.nome)}</a>`).join('');
    painel.hidden = !links.length;
    $('mlTabs').insertAdjacentHTML('beforeend', `<div data-tour="gm-lembretes"><a class="ml-tab" href="${comAgente(LINK_LEMBRETES.href, ag.id)}">` +
      `<span class="ml-ico" aria-hidden="true">${LINK_LEMBRETES.ico}</span>${LINK_LEMBRETES.nome}</a></div>` +
      `<div data-tour="gm-integracoes"><a class="ml-tab" href="${comAgente(LINK_INTEGRACOES.href, ag.id)}">` +
      `<span class="ml-ico" aria-hidden="true">${LINK_INTEGRACOES.ico}</span>${LINK_INTEGRACOES.nome}</a></div>`);
    // a Mesa já está no HTML com href="/mesa": passa a levar o agente junto
    const mesa = document.querySelector('#mlTabs a[href="/mesa"]');
    if (mesa) mesa.setAttribute('href', comAgente('/mesa', ag.id));
    agenteAtual = ag;
    recarregaLista = () => recarrega(ag, true);
    if (Array.isArray(opcoes.extras)) extras(opcoes.extras);

    /* Fora da Conversa, o item Conversa vira link para ela; na Conversa, só fecha a gaveta. */
    const irConversa = $('gmIrConversa');
    if (opcoes.ativo && opcoes.ativo !== 'conversa') {
      const a = document.createElement('a');
      a.className = 'ml-tab'; a.id = 'gmIrConversa';
      a.href = ag.id ? '/a/' + encodeURIComponent(ag.id) : '/';
      a.innerHTML = '<span class="ml-ico" aria-hidden="true">◔</span>Conversa';
      irConversa.replaceWith(a);
    } else {
      irConversa.onclick = () => opcoes.fecha();
    }
    marca(opcoes.ativo || 'conversa');
    $('mlInstalar').onclick = aoInstalar;
    // escolher uma página fecha a gaveta (a navegação em seguida troca a tela)
    $('mlTabs').addEventListener('click', ev => { if (ev.target.closest('a')) opcoes.fecha(); });
    pintaInstalar();
  }

  /* ── Trocar a foto do agente (18/10/2026) ─────────────────────────────────
     Tocar na foto grande abre a folha "Trocar foto". A imagem é recortada no centro e reduzida
     para 512 px aqui no aparelho (a foto do celular chega leve e já em pé) e sobe por
     PUT /api/v1/agents/<id>/avatar, onde o servidor confere e refaz. Depois de salvar, avisa a
     página pelo evento "dgavatar" (detail = o agente como /api/v1/agents devolve). */
  const ICO_CAMERA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  const ICO_IMAGEM = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg>';
  const ICO_LIXO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5"/></svg>';
  const ICO_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  let recarregaLista = null;

  function pintaMoldura(ag) {
    const mold = $('mlMoldura');
    if (!ag.id) {   // a lista não veio e não se sabe de quem é o menu: só a letra, sem troca
      mold.innerHTML = `<span class="ml-foto" style="background:${esc(ag.cor || '#2f9e5e')}">${fotoDe(ag)}</span>`;
      return;
    }
    mold.removeAttribute('aria-hidden');
    mold.innerHTML = `<button type="button" class="ml-foto-btn" id="mlFotoBtn" aria-label="${esc('Trocar a foto de ' + ag.nome)}" title="Trocar foto">` +
      `<span class="ml-foto" style="background:${esc(ag.cor || '#2f9e5e')}">${fotoDe(ag)}</span>` +
      `<span class="ml-foto-selo" aria-hidden="true">${ICO_CAMERA}</span></button>`;
    $('mlFotoBtn').onclick = () => abreFolhaFoto(agenteAtual || ag);
  }

  /* Lê a imagem (respeitando a rotação da câmera), recorta no centro e devolve um JPEG de até 512 px. */
  async function preparaFoto(arquivo) {
    let fonte, w, h, url = '';
    try {
      if (raiz.createImageBitmap) {
        fonte = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
        w = fonte.width; h = fonte.height;
      } else throw new Error('sem createImageBitmap');
    } catch (_) {
      url = URL.createObjectURL(arquivo);
      fonte = await new Promise((ok, falha) => {
        const im = new Image();
        im.onload = () => ok(im);
        im.onerror = () => falha(new Error('imagem ilegível'));
        im.src = url;
      });
      w = fonte.naturalWidth; h = fonte.naturalHeight;
    }
    try {
      const r = recorteQuadrado(w, h), lado = Math.min(512, r.lado);
      const cv = document.createElement('canvas');
      cv.width = cv.height = lado;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#fff';   // PNG transparente vira fundo branco, não preto
      cx.fillRect(0, 0, lado, lado);
      cx.drawImage(fonte, r.sx, r.sy, r.lado, r.lado, 0, 0, lado, lado);
      const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.9));
      if (!blob) throw new Error('o navegador não gerou a imagem');
      return blob;
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (fonte && fonte.close) fonte.close();
    }
  }

  function folhaFoto() {
    let veu = $('mlFotoVeu');
    if (veu) return veu;
    veu = document.createElement('div');
    veu.id = 'mlFotoVeu';
    veu.className = 'ml-fs-veu';
    veu.hidden = true;
    veu.innerHTML = '<div class="ml-fs" role="dialog" aria-modal="true" aria-labelledby="mlFotoTit" tabindex="-1">' +
      `<div class="ml-fs-cab"><h2 id="mlFotoTit">Trocar foto</h2><button type="button" class="ml-fs-x" data-fs="fechar" aria-label="Fechar">${ICO_X}</button></div>` +
      '<p class="ml-fs-sub" id="mlFotoSub"></p>' +
      '<div class="ml-fs-previa" id="mlFotoPrevia" aria-hidden="true"></div>' +
      `<button type="button" class="ml-fs-btn" data-fs="escolher">${ICO_IMAGEM}<span>Escolher foto</span></button>` +
      '<input type="file" id="mlFotoArq" accept="image/*" hidden>' +
      '<p class="ml-fs-dica">PNG, JPEG ou WebP. A foto fica redonda, cortada pelo centro.</p>' +
      '<p class="ml-fs-erro" id="mlFotoErro" role="alert" hidden></p>' +
      '<div class="ml-fs-acoes">' +
      `<button type="button" class="ml-fs-btn ml-fs-remover" data-fs="remover">${ICO_LIXO}<span>Remover foto</span></button>` +
      '<span class="ml-fs-esp"></span>' +
      '<button type="button" class="ml-fs-btn" data-fs="fechar">Cancelar</button>' +
      '<button type="button" class="ml-fs-btn ml-fs-salvar" data-fs="salvar" disabled>Salvar</button>' +
      '</div></div>';
    document.body.appendChild(veu);
    veu.addEventListener('click', ev => {
      if (ev.target === veu) return fechaFolhaFoto();
      const b = ev.target.closest('[data-fs]');
      if (!b || b.disabled) return;
      const acao = b.dataset.fs;
      if (acao === 'fechar') fechaFolhaFoto();
      else if (acao === 'escolher') $('mlFotoArq').click();
      else if (acao === 'salvar') salvaFoto();
      else if (acao === 'remover') removeFoto();
    });
    veu.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.stopPropagation(); fechaFolhaFoto(); }
    });
    $('mlFotoArq').addEventListener('change', async ev => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      const prob = problemaArquivo(f);
      if (prob) return erroFoto(prob);
      erroFoto('');
      try {
        folha.blob = await preparaFoto(f);
      } catch (e) {
        console.warn('menu-lado: não consegui abrir a foto escolhida:', e.message);
        folha.blob = null;
        return erroFoto('Não consegui abrir essa foto. Escolha uma foto PNG, JPEG ou WebP.');
      }
      if (folha.previa) URL.revokeObjectURL(folha.previa);
      folha.previa = URL.createObjectURL(folha.blob);
      pintaPrevia();
    });
    return veu;
  }

  const folha = { ag: null, blob: null, previa: '', ocupado: false, voltaFoco: null };

  function erroFoto(texto) {
    const e = $('mlFotoErro');
    e.textContent = texto;
    e.hidden = !texto;
  }

  function pintaPrevia() {
    const ag = folha.ag, pv = $('mlFotoPrevia');
    pv.style.background = ag.cor || '#2f9e5e';
    pv.innerHTML = folha.previa ? `<img src="${esc(folha.previa)}" alt="">` : fotoDe(ag);
    const temFoto = !!(ag.avatar_img || /^https:\/\//i.test(ag.avatar || ''));
    const veu = $('mlFotoVeu');
    veu.querySelector('[data-fs="salvar"]').disabled = folha.ocupado || !folha.blob;
    veu.querySelector('[data-fs="remover"]').hidden = !temFoto || !!folha.blob;
    veu.querySelector('[data-fs="escolher"] span').textContent = (temFoto || folha.blob) ? 'Escolher outra foto' : 'Escolher foto';
    veu.querySelectorAll('[data-fs]').forEach(b => { if (b.dataset.fs !== 'salvar') b.disabled = folha.ocupado; });
  }

  function abreFolhaFoto(ag) {
    const veu = folhaFoto();
    Object.assign(folha, { ag, blob: null, ocupado: false, voltaFoco: document.activeElement });
    if (folha.previa) URL.revokeObjectURL(folha.previa);
    folha.previa = '';
    $('mlFotoSub').textContent = 'A foto de ' + ag.nome + ' aparece na conversa, no menu e no painel.';
    erroFoto('');
    pintaPrevia();
    veu.hidden = false;
    requestAnimationFrame(() => veu.classList.add('aberto'));
    veu.querySelector('.ml-fs').focus();   // o foco entra na folha sem acender o anel no botão
  }

  function fechaFolhaFoto() {
    const veu = $('mlFotoVeu');
    if (!veu || veu.hidden || folha.ocupado) return;
    veu.classList.remove('aberto');
    veu.hidden = true;
    if (folha.previa) { URL.revokeObjectURL(folha.previa); folha.previa = ''; }
    folha.blob = null;
    if (folha.voltaFoco && folha.voltaFoco.focus) folha.voltaFoco.focus();
  }

  async function enviaFoto(metodo, corpo) {
    folha.ocupado = true;
    pintaPrevia();
    const salvar = $('mlFotoVeu').querySelector('[data-fs="salvar"]');
    if (metodo === 'PUT') salvar.textContent = 'Salvando...';
    try {
      const r = await fetch('/api/v1/agents/' + encodeURIComponent(folha.ag.id) + '/avatar', {
        method: metodo, credentials: 'same-origin', body: corpo || undefined,
        headers: corpo ? { 'Content-Type': corpo.type || 'image/jpeg' } : {},
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !d.ok) throw new Error((d && d.erro) || 'O servidor respondeu ' + r.status + '. Tente de novo.');
      fotoTrocada(d.agente);
      folha.ocupado = false;
      fechaFolhaFoto();
    } catch (e) {
      folha.ocupado = false;
      erroFoto(/fetch|network|rede/i.test(e.message) ? 'Sem conexão com o servidor. Confira a internet e tente de novo.' : e.message);
    } finally {
      salvar.textContent = 'Salvar';
      if (!$('mlFotoVeu').hidden) pintaPrevia();
    }
  }
  function salvaFoto() { if (folha.blob) enviaFoto('PUT', folha.blob); }
  function removeFoto() { enviaFoto('DELETE', null); }

  /* Foto nova (ou removida) salva: o menu muda na hora e a página é avisada para mudar o resto. */
  function fotoTrocada(novo) {
    if (!novo || !agenteAtual || novo.id !== agenteAtual.id) return;
    agenteAtual.avatar = novo.avatar;
    agenteAtual.avatar_img = novo.avatar_img;
    pintaMoldura(agenteAtual);
    if (recarregaLista) recarregaLista();
    document.dispatchEvent(new CustomEvent('dgavatar', { detail: { id: novo.id, avatar: novo.avatar, avatar_img: novo.avatar_img } }));
  }

  /* Tema em Configurações (18/10/2026): Automático, Claro ou Escuro, pelo tema.js (DGTema). O
     botão de tema antigo ficava no rodapé do menu do painel, que a casca esconde. */
  function pintaTema() {
    const pref = raiz.DGTema ? raiz.DGTema.preferencia() : 'auto';
    for (const b of document.querySelectorAll('#mlTema [data-tema-op]')) {
      const on = b.dataset.temaOp === pref;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest ? ev.target.closest('#mlTema [data-tema-op]') : null;
    if (!b || !raiz.DGTema) return;
    raiz.DGTema.escolhe(b.dataset.temaOp);
  });
  document.addEventListener('dgtema', pintaTema);
  // o seletor nasce com a casca (que monta depois); pinta assim que ele existir
  (function espera(n) { if (document.querySelector('#mlTema [data-tema-op]')) pintaTema(); else if (n > 0) setTimeout(() => espera(n - 1), 200); })(25);

  return { ABAS_PAINEL, LINK_LEMBRETES, itemAgente, linksPainel, linksExtras, comAgente, chaveDoHref, passosMenu, instrucaoInstalar, recorteQuadrado, problemaArquivo, inicia, marca, extras, abreFolhaFoto };
});
