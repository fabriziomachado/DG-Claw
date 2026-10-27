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


  /* Grupos do menu (19/10/2026, proposta A do dono): 19 itens soltos viraram quatro grupos que fecham.
     Trabalho nasce aberto; os outros, fechados, com quantos itens têm. O grupo da página aberta abre
     sozinho e o menu lembra o que a pessoa abriu. Item que não está aqui (poderes do painel) vai para
     Trabalho; "Como funciona" sai da lista e vira ícone no rodapé do menu. */
  const GRUPOS = [
    { id: 'trabalho', nome: 'Trabalho', chaves: ['caixa', 'conversa', 'mesa', 'sessoes', 'lembretes', 'referencias', 'avisos'] },
    { id: 'agente', nome: 'O agente', chaves: ['identity', 'personality', 'skills', 'rotinas', 'memory', 'arquivos'] },
    { id: 'conexoes', nome: 'Conexões', chaves: ['integracoes', 'apps', 'cofre'] },
    { id: 'saude', nome: 'Saúde', chaves: ['saude-servidor', 'status', 'operations', 'costs', 'socorro'] },
  ];
  const NO_RODAPE = ['como'];
  function grupoDe(chave) {
    if (NO_RODAPE.includes(chave)) return '';
    const g = GRUPOS.find(x => x.chaves.includes(chave));
    return g ? g.id : 'trabalho';
  }

  /* Entradas fixas do menu: a tela de lembretes e a de avisos (valem para qualquer agente). */
  const LINK_LEMBRETES = { nome: 'Lembretes', ico: '⏰', href: '/lembretes' };
  /* Entrada fixa: as integrações de todos os agentes (conectores, plugins, skills, chaves, canais). */
  const LINK_INTEGRACOES = { nome: 'Integrações', ico: '⧉', href: '/integracoes' };

  const LINK_AVISOS = { nome: 'Avisos', ico: '🔔', href: '/avisos' };
  /* Referências (25/10/2026): os links que o dono guarda, resumidos pelo Tech. */
  const LINK_REFERENCIAS = { nome: 'Referências', ico: '🔖', href: '/referencias' };
  /* Caixa de entrada (19/10/2026): tudo que espera o dono, de todos os agentes; o número em vermelho é o do ícone do app. */
  const LINK_CAIXA = { nome: 'Caixa de entrada', ico: '📥', href: '/caixa' };
  /* Saúde do servidor (20/10/2026): só no menu do Admin, que não tem painel e ficava sem o grupo Saúde. */
  const LINK_SAUDE_SERVIDOR = { nome: 'Saúde do servidor', ico: '◉', href: '/saude' };

  /* Sessões é item fixo para todo agente com painel (a tela fica no painel dele). Devolve o link do menu e os
     endereços que o menu consulta (config: a aba está ligada? pedidos: quantas sessões esperam o dono), ou null. */
  function linkSessoes(a) {
    if (!a || !a.tem_painel) return null;
    const base0 = a.painel_url || ('/p/' + encodeURIComponent(a.id) + '/');
    const base = base0.replace(/\/*$/, '/');
    return { nome: 'Sessões', ico: '🖥', href: base + '#aba=sessoes',
      config: base + 'api/sessoes-config', pedidos: base + 'api/sessoes?grupo=esperando_voce&limite=1' };
  }

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
    if (caminho === '/referencias') return 'referencias';
    if (caminho === '/integracoes') return 'integracoes';
    if (caminho === '/avisos') return 'avisos';
    if (caminho === '/caixa') return 'caixa';
    if (caminho === '/saude') return 'saude-servidor';
    if (/^\/a\/[^/]+$/.test(caminho)) return 'conversa';
    return '';
  }

  /* Itens extras do painel que dependem do que está ligado (Sessões e os poderes). Cada um: { chave, ico, nome }. */
  function linksExtras(a, extras) {
    if (!a || !a.tem_painel || !Array.isArray(extras)) return [];
    const base = a.painel_url || ('/p/' + encodeURIComponent(a.id) + '/');
    // Sessões é item fixo (linkSessoes): um painel de versão antiga que ainda a mande como extra não a duplica
    return extras.filter(x => x && x.chave && x.chave !== 'sessoes' && x.nome).map(x => ({ nome: x.nome, ico: x.ico || '•', href: base + '#aba=' + x.chave }));
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
        ' Os itens ficam em quatro grupos (Trabalho, O agente, Conexões e Saúde); tocar no nome do grupo abre ou fecha, e o menu lembra a sua escolha. Tocar na foto abre a troca de foto. No rodapé ficam o tema, instalar o app, como funciona, este tutorial e sair. No celular, dá para abrir o menu arrastando o dedo da borda esquerda.',
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

  /* Hora da última mensagem: "hh:mm" se foi hoje, "ontem" ou "dd/mm". ts em epoch ms; sem ts (null,
     0 ou inválido) devolve '' e o item fica sem hora, porque "não sei" não é "meia-noite de 1970". */
  function horaCurta(ts, agora) {
    if (typeof ts !== 'number' || !isFinite(ts) || ts <= 0) return '';
    const d = new Date(ts), hoje = agora ? new Date(agora) : new Date();
    const dia = x => x.getFullYear() * 10000 + x.getMonth() * 100 + x.getDate();
    const p2 = n => String(n).padStart(2, '0');
    if (dia(d) === dia(hoje)) return p2(d.getHours()) + ':' + p2(d.getMinutes());
    const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
    if (dia(d) === dia(ontem)) return 'ontem';
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1);
  }

  /* O selo de atenção de um agente. `a` traz o que o servidor diz (GET /api/v1/estados): estado, resumo,
     nao_lidas, marcada_nao_lida. Prioridade: precisa de você > não lido > trabalhando. O agente em que a pessoa
     já está não ganha selo (a própria conversa mostra o que ele faz). Devolve { tipo, rotulo, resumo } ou null.
     `nao_lidas` null (não medido) não vira bolinha; "sem sinal" também não vira selo nenhum. */
  function seloDe(a, aqui) {
    if (!a || aqui) return null;
    if (a.estado === 'precisa_de_voce') {
      return { tipo: 'precisa', rotulo: 'precisa de você' + (a.resumo ? ': ' + a.resumo : ''), resumo: a.resumo || '' };
    }
    const n = a.nao_lidas;
    const temN = typeof n === 'number' && isFinite(n) && n > 0;
    if (temN) return { tipo: 'nao_lido', rotulo: n + (n === 1 ? ' mensagem não lida' : ' mensagens não lidas') + (a.mais ? ' ou mais' : ''), n };
    if (a.marcada_nao_lida === true) return { tipo: 'marcada', rotulo: 'marcada como não lida' };
    if (a.estado === 'trabalhando') return { tipo: 'trabalhando', rotulo: 'trabalhando' };
    return null;
  }

  function seloMenu(a, aqui) {
    const s = seloDe(a, aqui);
    if (!s) return '';
    if (s.tipo === 'precisa') return `<span class="ml-aten" role="img" aria-label="${esc(s.rotulo)}">!</span>`;
    if (s.tipo === 'nao_lido') return bolinhaMenu(a, aqui);
    if (s.tipo === 'marcada') return `<span class="ml-nl ml-nl-ponto" role="img" aria-label="${esc(s.rotulo)}"></span>`;
    return `<span class="ml-trab" role="img" aria-label="${esc(s.rotulo)}"><i></i><i></i><i></i></span>`;
  }

  function itemAgente(a, atualId) {
    const aqui = a.id === atualId;
    const selo = seloDe(a, aqui);
    // quem precisa de você mostra o motivo no lugar do subtítulo: é a razão de olhar para ele agora
    const sub = selo && selo.tipo === 'precisa' && selo.resumo ? selo.resumo
      : (a.subtitulo || [a.provedor, a.modelo].filter(Boolean).join(' · '));
    const link = `<a class="ml-ag${aqui ? ' atual' : ''}${selo && selo.tipo === 'precisa' ? ' precisa' : ''}" role="menuitem" href="/a/${encodeURIComponent(a.id)}"` +
      `${aqui ? ' aria-current="page"' : ''}>` +
      `<span class="ml-mini" style="background:${esc(a.cor || '#2f9e5e')}">${fotoDe(a)}</span>` +
      `<span class="ml-quem"><b>${esc(a.nome)}</b><small>${esc(sub)}</small></span>` +
      `${aqui ? '<span class="ml-aqui">aqui</span>' : ''}` +
      `${horaCurta(a.ultima_ts) ? `<span class="ml-hora">${esc(horaCurta(a.ultima_ts))}</span>` : ''}` +
      `${seloMenu(a, aqui)}</a>`;
    if (aqui) return link;
    // O ⋯ é a via acessível para marcar como não lida (o toque longo no item faz o mesmo).
    const marcada = a.marcada_nao_lida === true;
    const id = esc(a.id);
    return `<div class="ml-linha">${link}` +
      `<button type="button" class="ml-mais" data-mais="${id}" aria-haspopup="true" aria-expanded="${a.acoes_abertas ? 'true' : 'false'}" ` +
      `aria-label="Mais ações de ${esc(a.nome)}" title="Mais ações">⋯</button>` +
      `<div class="ml-acoes"${a.acoes_abertas ? '' : ' hidden'}>` +
      `<button type="button" data-nao-lida="${id}" data-ligar="${marcada ? '0' : '1'}">${marcada ? 'Desmarcar como não lida' : 'Marcar como não lida'}</button></div></div>`;
  }

  /* Bolinha de não lidas. `a.nao_lidas` é número (a contagem do servidor), `a.mais` marca "passou do teto".
     null (não medido), 0 e o agente em que a pessoa já está não mostram nada: sumir é melhor que mentir. */
  function bolinhaMenu(a, aqui) {
    const n = a.nao_lidas;
    if (aqui || typeof n !== 'number' || !isFinite(n) || n <= 0) return '';
    const texto = (a.mais || n > 99) ? '99+' : String(n);
    const rot = n + (n === 1 ? ' mensagem não lida' : ' mensagens não lidas') + (a.mais ? ' ou mais' : '');
    return `<span class="ml-nl" role="img" aria-label="${esc(rot)}">${texto}</span>`;
  }

  /* Soma das não lidas dos OUTROS agentes. null (não medido) entra como nada, nunca como número.
     Conversa marcada como não lida, sem mensagem nova, conta como 1. */
  function totalNaoLidas(lista, contagens, atualId) {
    let total = 0;
    for (const a of lista || []) {
      const c = contagens && contagens[a.id];
      const n = c && c.nao_lidas;
      if (a.id === atualId) continue;
      if (typeof n === 'number' && isFinite(n) && n > 0) total += n;
      else if (c && c.marcada_nao_lida === true) total += 1;
    }
    return total;
  }

  /* Quantos dos OUTROS agentes precisam de você agora (liga o selo âmbar do ☰). */
  function totalPrecisam(lista, contagens, atualId) {
    let total = 0;
    for (const a of lista || []) {
      const c = contagens && contagens[a.id];
      if (a.id !== atualId && c && c.estado === 'precisa_de_voce') total += 1;
    }
    return total;
  }


  /* Uso das assinaturas (☰ > Uso das assinaturas). Verde abaixo de 70, âmbar de 70 a 89, vermelho a partir de 90. */
  function corUso(pct) { return pct >= 90 ? 'vermelho' : pct >= 70 ? 'ambar' : 'verde'; }

  /* "hoje 18:40", "amanhã 09:00", "qua 09:00" ou "25/10 09:00", no horário do aparelho. */
  function quandoZeraUso(iso, agora) {
    const d = new Date(iso), hoje = agora ? new Date(agora) : new Date();
    if (!isFinite(d.getTime())) return '';
    const p2 = n => String(n).padStart(2, '0');
    const dia0 = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dias = Math.round((dia0(d) - dia0(hoje)) / 86400000);
    const hora = p2(d.getHours()) + ':' + p2(d.getMinutes());
    if (dias === 0) return 'hoje ' + hora;
    if (dias === 1) return 'amanhã ' + hora;
    if (dias > 1 && dias < 7) return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()] + ' ' + hora;
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' ' + hora;
  }

  /* Uma mini barra. janela = { usado_pct, zera_em, vencida } ou null (não medido: "sem dado", nunca 0%). */
  function miniBarraUso(rotulo, janela, agora) {
    if (!janela || typeof janela.usado_pct !== 'number' || !isFinite(janela.usado_pct)) {
      return `<div class="ml-uso-lin"><span class="ml-uso-rot">${esc(rotulo)}</span><span class="ml-uso-bar"><i style="width:0"></i></span><span class="ml-uso-pct sem">sem dado</span></div>`;
    }
    if (janela.vencida) {
      return `<div class="ml-uso-lin" title="Zerou em ${esc(quandoZeraUso(janela.zera_em, agora))}. A nova medição chega na próxima resposta do agente."><span class="ml-uso-rot">${esc(rotulo)}</span><span class="ml-uso-bar"><i style="width:0"></i></span><span class="ml-uso-pct sem">zerou</span></div>`;
    }
    const pct = Math.max(0, Math.min(100, janela.usado_pct));
    const txt = (Number.isInteger(pct) ? String(pct) : pct.toFixed(1).replace('.', ',')) + '%';
    return `<div class="ml-uso-lin" title="Zera em ${esc(quandoZeraUso(janela.zera_em, agora))}"><span class="ml-uso-rot">${esc(rotulo)}</span>` +
      `<span class="ml-uso-bar ${corUso(pct)}" role="img" aria-label="${esc(rotulo)}: ${esc(txt)} usado"><i style="width:${pct}%"></i></span><span class="ml-uso-pct">${esc(txt)}</span></div>`;
  }

  /* Um agente na lista de uso. entrada = { uso, motivo? } ou { uso:null, erro }. */
  function itemUso(a, entrada, agora) {
    const nome = `<b class="ml-uso-nome">${esc(a.nome || a.id)}</b>`;
    if (!entrada) return `<div class="ml-uso-ag">${nome}<div class="ml-uso-nota">Sem resposta do servidor sobre este agente.</div></div>`;
    if (entrada.erro || !entrada.uso) {
      return `<div class="ml-uso-ag">${nome}${miniBarraUso('5 h', null)}${miniBarraUso('Sem', null)}` +
        `<div class="ml-uso-nota">${esc(entrada.erro || 'Sem dado de uso.')}</div></div>`;
    }
    const u = entrada.uso;
    const nota = entrada.motivo ? `<div class="ml-uso-nota">${esc(entrada.motivo)}</div>` : '';
    return `<div class="ml-uso-ag">${nome}${miniBarraUso('5 h', u.sessao_5h, agora)}${miniBarraUso('Sem', u.semanal, agora)}${nota}</div>`;
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

  /* Enquadramento da foto (o "Ajustar" da folha Trocar foto). Tudo em pixels do quadro na tela:
     a = { w, h (tamanho da imagem), lado (quadro quadrado, onde o círculo fica inscrito),
           zoom (1 = a imagem cobre o quadro, até ZOOM_MAX), x, y (canto da imagem dentro do quadro) }.
     A imagem nunca deixa sobra dentro do quadro: x fica entre lado - largura e 0 (idem y). */
  const ZOOM_MAX = 4;
  const escalaCobre = (w, h, lado) => lado / Math.max(1, Math.min(w, h));
  function limitaAjuste(a) {
    const zoom = Math.min(ZOOM_MAX, Math.max(1, Number(a.zoom) || 1));
    const e = escalaCobre(a.w, a.h, a.lado) * zoom, W = a.w * e, H = a.h * e;
    const prende = (v, tam) => Math.min(0, Math.max(a.lado - tam, Number.isFinite(v) ? v : (a.lado - tam) / 2));
    return { w: a.w, h: a.h, lado: a.lado, zoom, x: prende(a.x, W), y: prende(a.y, H) };
  }
  /* Começo: zoom 1, imagem centrada (sem x/y, limitaAjuste centra). */
  const ajusteInicial = (w, h, lado) => limitaAjuste({ w, h, lado, zoom: 1, x: NaN, y: NaN });
  const moveAjuste = (a, dx, dy) => limitaAjuste(Object.assign({}, a, { x: a.x + dx, y: a.y + dy }));
  /* Zoom mantendo parado o ponto (fx, fy) do quadro: o dedo da pinça, o cursor da roda ou o centro. */
  function zoomNoPonto(a, zoom, fx, fy) {
    const z = Math.min(ZOOM_MAX, Math.max(1, Number(zoom) || 1));
    const r = z / a.zoom;
    return limitaAjuste(Object.assign({}, a, { zoom: z, x: fx - (fx - a.x) * r, y: fy - (fy - a.y) * r }));
  }
  /* O que está dentro do quadrado do círculo, em pixels da imagem (para o drawImage). */
  function recorteDoAjuste(a) {
    const e = escalaCobre(a.w, a.h, a.lado) * a.zoom, lado = Math.min(a.w, a.h, a.lado / e);
    const sx = Math.min(a.w - lado, Math.max(0, -a.x / e)), sy = Math.min(a.h - lado, Math.max(0, -a.y / e));
    return { sx, sy, lado };
  }

  /* O que a escolha do arquivo diz antes de subir: '' (segue) ou a frase de erro. */
  function problemaArquivo(f) {
    if (!f) return 'Nenhuma foto escolhida.';
    if (f.type && !/^image\//.test(f.type)) return 'Esse arquivo não é uma foto. Escolha uma foto PNG, JPEG ou WebP.';
    if (/svg/i.test(f.type || '') || /\.svg$/i.test(f.name || '')) return 'Desenho SVG não serve como foto. Escolha uma foto PNG, JPEG ou WebP.';
    if (f.size > 40 * 1024 * 1024) return 'Essa foto é grande demais. Escolha uma de até 40 MB (ela é reduzida antes de enviar).';
    return '';
  }

  if (!raiz.document) return { GRUPOS, grupoDe, LINK_CAIXA, LINK_SAUDE_SERVIDOR, corUso, quandoZeraUso, miniBarraUso, itemUso, ABAS_PAINEL, LINK_LEMBRETES, LINK_AVISOS, linkSessoes, itemAgente, bolinhaMenu, seloDe, totalNaoLidas, totalPrecisam, horaCurta, linksPainel, linksExtras, comAgente, chaveDoHref, passosMenu, instrucaoInstalar, recorteQuadrado, problemaArquivo, ZOOM_MAX, escalaCobre, limitaAjuste, ajusteInicial, moveAjuste, zoomNoPonto, recorteDoAjuste };

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
    ultimaLista = { ag, lista };
    caixa.innerHTML = ordem.map(a => {
      const c = contagens[a.id];
      const base = c ? Object.assign({}, a, { nao_lidas: c.nao_lidas, mais: c.mais, estado: c.estado, resumo: c.resumo, marcada_nao_lida: c.marcada_nao_lida }) : a;
      return itemAgente(Object.assign(base, { acoes_abertas: acoesAbertaDe === a.id }), ag.id);
    }).join('');
    pintaTotalTroca(totalNaoLidas(lista, contagens, ag.id), totalPrecisam(lista, contagens, ag.id));
  }

  /* A lista vem recolhida: sem o total no botão, a bolinha de cada agente só aparece depois do toque. */
  function pintaTotalTroca(total, precisam) {
    const btn = $('mlTrocaBtn');
    if (!btn) return;
    let aten = $('mlTrocaAten');
    if (!aten) {
      aten = document.createElement('span');
      aten.id = 'mlTrocaAten'; aten.className = 'ml-aten'; aten.setAttribute('role', 'img'); aten.textContent = '!';
      btn.insertBefore(aten, btn.querySelector('.ml-seta'));
    }
    aten.style.display = precisam > 0 ? '' : 'none';
    aten.setAttribute('aria-label', precisam + (precisam === 1 ? ' agente precisa de você' : ' agentes precisam de você'));
    let marca = $('mlTrocaNl');
    if (!marca) {
      marca = document.createElement('span');
      marca.id = 'mlTrocaNl'; marca.className = 'ml-nl'; marca.setAttribute('role', 'img');
      btn.insertBefore(marca, btn.querySelector('.ml-seta'));
    }
    marca.style.display = total > 0 ? '' : 'none';
    marca.textContent = total > 99 ? '99+' : String(total);
    marca.setAttribute('aria-label', total + (total === 1 ? ' mensagem não lida' : ' mensagens não lidas') + ' em outros agentes');
  }

  /* Contagens de não lidas por agente (slug -> objeto do servidor). Guardadas aqui para a lista de 30 s
     também pintar a bolinha, e repintada quando a tela entrega uma contagem nova. */
  let contagens = {}, ultimaLista = null, acoesAbertaDe = null;
  function defineNaoLidas(mapa) {
    contagens = mapa && typeof mapa === 'object' ? mapa : {};
    if (ultimaLista) pintaLista(ultimaLista.ag, ultimaLista.lista, null);
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


  /* ── Uso das assinaturas: só busca quando a seção é aberta, e repete a cada 60 s enquanto ela está aberta ── */
  let timerUso = null;
  async function carregaUso() {
    const caixa = $('mlUsoLista');
    if (!caixa) return;
    if (!caixa.innerHTML) caixa.innerHTML = '<div class="ml-vazio">Conferindo o uso...</div>';
    try {
      const r = await fetch('/api/v1/uso', { cache: 'no-store', credentials: 'same-origin' });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || d.ok === false) throw new Error((d && d.erro) || ('a API respondeu ' + r.status));
      const lista = ultimaLista ? ultimaLista.lista : [];
      const nomes = new Map(lista.map(a => [a.id, a]));
      const slugs = Object.keys(d.agentes || {});
      const ordem = lista.map(a => a.id).filter(id => slugs.includes(id)).concat(slugs.filter(id => !nomes.has(id)));
      caixa.innerHTML = ordem.length
        ? ordem.map(id => itemUso(nomes.get(id) || { id, nome: id }, d.agentes[id], Date.now())).join('')
        : '<div class="ml-vazio">Nenhum agente no registro.</div>';
    } catch (e) {
      console.warn('menu-lado: não consegui ler o uso das assinaturas:', e.message);
      caixa.innerHTML = `<div class="ml-vazio" role="alert">Não consegui ver o uso das assinaturas: ${esc(e.message)}. Feche e abra esta seção para tentar de novo.</div>`;
    }
  }

  function ligaUso() {
    const det = $('mlUsoDet');
    if (!det || det._ligado) return;
    det._ligado = true;
    det.addEventListener('toggle', () => {
      if (timerUso) { clearInterval(timerUso); timerUso = null; }
      if (!det.open) return;
      carregaUso();
      timerUso = setInterval(() => { if (document.visibilityState === 'visible') carregaUso(); }, 60000);
    });
  }

  let agenteAtual = null;

  /* ── Sessões: o item do menu e o botão 🖥 do cabeçalho ──────────────────────
     Perguntamos UMA vez por agente se a aba está ligada (GET <painel>/api/sessoes-config), sem travar a tela.
     Só ligado:false esconde o item e o botão. Erro de rede ou resposta estranha NÃO esconde: o item fica e o
     motivo vai para o console, porque sumir com a porta por causa de um tropeço seria pior que mostrá-la. */
  const consultaSessoes = new Map();   // id do agente -> Promise<{ ligado: boolean|null }>
  function configSessoes(l, id) {
    if (!consultaSessoes.has(id)) {
      consultaSessoes.set(id, fetch(l.config, { cache: 'no-store', credentials: 'same-origin' })
        .then(async r => {
          const d = await r.json().catch(() => null);
          if (!r.ok || !d) throw new Error('o painel respondeu ' + r.status + ' a ' + l.config);
          return { ligado: d.ligado === false ? false : true };
        })
        .catch(e => {
          console.warn('menu-lado: não consegui saber se a aba Sessões está ligada (' + e.message + '). Deixei o item no menu.');
          return { ligado: null };
        }));
    }
    return consultaSessoes.get(id);
  }

  /* Bolinha de pedidos: quantas sessões esperam uma decisão do dono. Sem contagem na resposta, sem bolinha. */
  async function contaPedidos(l) {
    const r = await fetch(l.pedidos, { cache: 'no-store', credentials: 'same-origin' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || !d.contagem) throw new Error('o painel respondeu ' + r.status + ' a ' + l.pedidos);
    return Number(d.contagem.esperando_voce) || 0;
  }

  function ligaSessoes(ag) {
    const l = linkSessoes(ag);
    if (!l) return;
    const itens = [$('mlSessoes'), $('btnSessoes')].filter(Boolean);
    const btn = $('btnSessoes');
    if (btn) { btn.href = l.href; btn.hidden = true; }
    const pinta = n => itens.forEach(el => {
      let b = el.querySelector('.sx-bol');
      if (n > 0 && !b) { b = document.createElement('i'); b.className = 'sx-bol'; b.setAttribute('aria-hidden', 'true'); el.appendChild(b); }
      if (b) b.hidden = !(n > 0);
      el.title = n > 0 ? 'Sessões (' + n + (n === 1 ? ' pedido esperando você)' : ' pedidos esperando você)') : 'Sessões de trabalho deste agente';
    });
    let avisouPedidos = false;
    const atualiza = () => {
      if (document.visibilityState !== 'visible') return;
      contaPedidos(l).then(pinta, e => {
        if (!avisouPedidos) { avisouPedidos = true; console.warn('menu-lado: sem a contagem de pedidos das Sessões (' + e.message + '); a bolinha fica apagada.'); }
      });
    };
    configSessoes(l, ag.id).then(c => {
      if (c.ligado === false) {
        const item = $('mlSessoes');
        if (item) item.parentElement.remove();
        if (btn) btn.remove();
        marca(chaveAtiva);
        return;
      }
      if (btn) btn.hidden = false;
      atualiza();
      document.addEventListener('visibilitychange', atualiza);
      setInterval(atualiza, 45000);
    });
  }

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
    pintaGrupos();
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
    agrupa();
    marca(chaveAtiva);
  }

  /* O ⋯ de cada item e o toque longo abrem "Marcar como não lida". A lista é repintada a cada contagem nova,
     então qual item está com as ações abertas fica guardado (acoesAbertaDe) e a repintura o mantém aberto. */
  function ligaAcoes(opcoes, troca) {
    const caixa = $('mlLista');
    const repinta = () => { if (ultimaLista) pintaLista(ultimaLista.ag, ultimaLista.lista, null); };
    caixa.addEventListener('click', async ev => {
      const mais = ev.target.closest('[data-mais]');
      if (mais) { acoesAbertaDe = acoesAbertaDe === mais.dataset.mais ? null : mais.dataset.mais; repinta(); return; }
      const acao = ev.target.closest('[data-nao-lida]');
      if (!acao) return;
      const slug = acao.dataset.naoLida, ligar = acao.dataset.ligar === '1';
      acao.disabled = true;
      try {
        if (typeof opcoes.marcarNaoLida !== 'function') throw new Error('esta tela não sabe marcar como não lida');
        await opcoes.marcarNaoLida(slug, ligar);
        acoesAbertaDe = null;
      } catch (e) {
        console.warn('menu-lado: não consegui ' + (ligar ? 'marcar' : 'desmarcar') + ' ' + slug + ' como não lida:', e.message);
        acao.disabled = false;
        acao.textContent = 'Não consegui: ' + e.message;
        return;
      }
      repinta();
    });
    /* Toque longo (~0,5 s) no item: abre as ações em vez de navegar. O clique que vem logo depois do
       soltar é engolido uma vez, senão a pessoa seria levada para a conversa. */
    let timer = null, longo = false;
    const cancela = () => { clearTimeout(timer); timer = null; };
    caixa.addEventListener('pointerdown', ev => {
      const item = ev.target.closest('a.ml-ag'); if (!item || item.classList.contains('atual')) return;
      longo = false; cancela();
      timer = setTimeout(() => {
        longo = true;
        const m = item.parentElement && item.parentElement.querySelector('[data-mais]');
        if (m) { acoesAbertaDe = m.dataset.mais; repinta(); }
      }, 500);
    });
    for (const nome of ['pointerup', 'pointerleave', 'pointercancel', 'scroll']) caixa.addEventListener(nome, cancela, true);
    caixa.addEventListener('click', ev => { if (longo && ev.target.closest('a.ml-ag')) { ev.preventDefault(); ev.stopPropagation(); } longo = false; }, true);
    caixa.addEventListener('contextmenu', ev => { if (ev.target.closest('a.ml-ag')) ev.preventDefault(); });
  }

  /* opcoes: { agente, agentes (a lista já carregada), fecha() (fecha a gaveta), ativo (chave da página aberta; padrão 'conversa'), extras (itens extras do painel), erroLista (texto: a lista de agentes falhou) } */
  function inicia(opcoes) {
    const ag = opcoes.agente;
    pintaMoldura(ag);
    $('mlNome').textContent = ag.nome;
    $('mlSub').textContent = ag.subtitulo || (ag.tipo === 'admin' ? 'administrador do servidor' : [ag.provedor, ag.modelo].filter(Boolean).join(' · '));
    document.documentElement.classList.add('ml-ativo');

    const troca = $('mlTroca'), btn = $('mlTrocaBtn');
    const abre = sim => { troca.classList.toggle('aberto', sim); btn.setAttribute('aria-expanded', String(sim)); };
    btn.onclick = () => abre(!troca.classList.contains('aberto'));
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && troca.classList.contains('aberto')) { abre(false); ev.stopPropagation(); }
    }, true);
    ligaAcoes(opcoes, troca);
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
      `<div data-tour="gm-referencias"><a class="ml-tab" href="${comAgente(LINK_REFERENCIAS.href, ag.id)}">` +
      `<span class="ml-ico" aria-hidden="true">${LINK_REFERENCIAS.ico}</span>${LINK_REFERENCIAS.nome}</a></div>` +
      `<div data-tour="gm-integracoes"><a class="ml-tab" href="${comAgente(LINK_INTEGRACOES.href, ag.id)}">` +
      `<span class="ml-ico" aria-hidden="true">${LINK_INTEGRACOES.ico}</span>${LINK_INTEGRACOES.nome}</a></div>`);
    $('mlTabs').insertAdjacentHTML('afterbegin', `<div data-tour="gm-caixa"><a class="ml-tab" id="mlCaixa" href="${comAgente(LINK_CAIXA.href, ag.id)}">` +
      `<span class="ml-ico" aria-hidden="true">${LINK_CAIXA.ico}</span>${LINK_CAIXA.nome}<span class="ml-n" hidden></span></a></div>`);
    ligaCaixa();
    $('mlTabs').insertAdjacentHTML('beforeend', `<div data-tour="gm-avisos"><a class="ml-tab" href="${comAgente(LINK_AVISOS.href, ag.id)}">` +
      `<span class="ml-ico" aria-hidden="true">${LINK_AVISOS.ico}</span>${LINK_AVISOS.nome}</a></div>`);
    if (ag.tipo === 'admin') {
      $('mlTabs').insertAdjacentHTML('beforeend', `<div data-tour="gm-saude-servidor"><a class="ml-tab" href="${LINK_SAUDE_SERVIDOR.href}">` +
        `<span class="ml-ico" aria-hidden="true">${LINK_SAUDE_SERVIDOR.ico}</span>${LINK_SAUDE_SERVIDOR.nome}</a></div>`);
    }
    // a Mesa já está no HTML com href="/mesa": passa a levar o agente junto
    const mesa = document.querySelector('#mlTabs a[href="/mesa"]');
    if (mesa) mesa.setAttribute('href', comAgente('/mesa', ag.id));
    // Sessões logo depois da Mesa, para todo agente com painel, em todas as telas
    const sess = linkSessoes(ag);
    if (sess && mesa) {
      mesa.parentElement.insertAdjacentHTML('afterend', `<div data-tour="gm-sessoes"><a class="ml-tab" id="mlSessoes" href="${esc(sess.href)}">` +
        `<span class="ml-ico" aria-hidden="true">${sess.ico}</span>${sess.nome}</a></div>`);
    }
    ligaSessoes(ag);
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
    ligaUso();
    pintaInstalar();
    agrupa();
    montaRodape(ag);
    marca(chaveAtiva);
    ligaDeslizar();
  }

  /* ── Contagem da Caixa de entrada: pedidos e entregas não vistos + lembretes tocando ── */
  let caixaLigada = false;
  async function atualizaCaixa() {
    const el = $('mlCaixa');
    if (!el || document.hidden) return;
    try {
      const pega = u => fetch(u, { credentials: 'same-origin', cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
      const [cx, lb] = await Promise.all([pega('/api/v1/caixa'), pega('/api/v1/lembretes')]);
      if (!cx) return;
      const n = (cx.total || 0) + ((lb && lb.insistindo) ? lb.insistindo.length : 0);
      const b = el.querySelector('.ml-n');
      b.textContent = n > 99 ? '99+' : String(n);
      b.hidden = !n;
      el.title = n ? 'Caixa de entrada: ' + n + (n === 1 ? ' item esperando você' : ' itens esperando você') : 'Caixa de entrada';
    } catch (e) { console.warn('menu-lado: não atualizei a contagem da caixa de entrada:', e.message); }
  }
  function ligaCaixa() {
    if (caixaLigada) return;
    caixaLigada = true;
    atualizaCaixa();
    setInterval(atualizaCaixa, 30000);
    document.addEventListener('visibilitychange', atualizaCaixa);
  }

  /* ── Grupos (ver GRUPOS) ──────────────────────────────────────────────── */
  const CHAVE_GRUPOS = 'dgclaw:menu-grupos';
  const ICO_GRUPO = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  function gruposSalvos() {
    try { return JSON.parse(localStorage.getItem(CHAVE_GRUPOS) || '{}') || {}; } catch (_) { return {}; }
  }
  /* Põe cada item do menu no seu grupo. Idempotente: roda de novo quando os extras do painel chegam.
     Move o item inteiro (com o <div data-tour> em volta, quando há), então o tour e o resto seguem achando. */
  function agrupa() {
    const nav = $('mlTabs');
    if (!nav) return;
    for (const g of GRUPOS) {
      if (nav.querySelector(`.ml-grupo[data-grupo="${g.id}"]`)) continue;
      nav.insertAdjacentHTML('beforeend', `<section class="ml-grupo" data-grupo="${g.id}">` +
        `<button type="button" class="ml-gcab" aria-expanded="false">${ICO_GRUPO}<span>${esc(g.nome)}</span><span class="ml-gqt"></span></button>` +
        '<div class="ml-gitens"></div></section>');
    }
    const unidades = [...nav.querySelectorAll('.ml-tab')].map(el => {
      const pai = el.parentElement;
      const un = pai && pai.matches('div[data-tour]') && pai.id !== 'mlPainel' ? pai : el;
      const chave = el.id === 'gmIrConversa' ? 'conversa' : chaveDoHref(el.getAttribute('href') || '');
      return { el, un, chave };
    });
    for (const g of GRUPOS) {
      const lista = nav.querySelector(`.ml-grupo[data-grupo="${g.id}"] .ml-gitens`);
      const daqui = unidades.filter(u => grupoDe(u.chave) === g.id);
      daqui.sort((x, y) => (g.chaves.indexOf(x.chave) + 1 || 99) - (g.chaves.indexOf(y.chave) + 1 || 99));
      daqui.forEach(u => lista.appendChild(u.un));
    }
    unidades.filter(u => !grupoDe(u.chave)).forEach(u => { u.un.hidden = true; });
    const painel = $('mlPainel');
    if (painel) painel.hidden = true;
    pintaGrupos();
  }
  function pintaGrupos() {
    const salvos = gruposSalvos();
    document.querySelectorAll('#mlTabs .ml-grupo').forEach(sec => {
      const id = sec.dataset.grupo, itens = sec.querySelector('.ml-gitens');
      const qt = [...itens.children].filter(x => !x.hidden).length;
      sec.hidden = !qt;
      const temAtivo = !!itens.querySelector('.ml-tab.ativo');
      const aberto = temAtivo || (id in salvos ? !!salvos[id] : id === 'trabalho');
      sec.classList.toggle('aberto', aberto);
      itens.hidden = !aberto;
      const cab = sec.querySelector('.ml-gcab');
      cab.setAttribute('aria-expanded', String(aberto));
      sec.querySelector('.ml-gqt').textContent = aberto ? '' : String(qt);
    });
  }
  document.addEventListener('click', ev => {
    const cab = ev.target.closest ? ev.target.closest('#mlTabs .ml-gcab') : null;
    if (!cab) return;
    const sec = cab.closest('.ml-grupo'), salvos = gruposSalvos();
    salvos[sec.dataset.grupo] = !sec.classList.contains('aberto');
    try { localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(salvos)); } catch (_) { /* sem armazenamento: vale até recarregar */ }
    // fechar o grupo da página aberta também vale: a regra "abre sozinho" é só na chegada
    if (!salvos[sec.dataset.grupo]) { sec.classList.remove('aberto'); sec.querySelector('.ml-gitens').hidden = true; cab.setAttribute('aria-expanded', 'false');
      sec.querySelector('.ml-gqt').textContent = String([...sec.querySelector('.ml-gitens').children].filter(x => !x.hidden).length); return; }
    pintaGrupos();
  });

  /* ── Rodapé do menu: tema, instalar, como funciona, tutorial e sair viram ícones ── */
  const ico18 = d => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICO_RODAPE = {
    auto: ico18('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17A8.5 8.5 0 0 0 12 3.5z" fill="currentColor"/>'),
    claro: ico18('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'),
    escuro: ico18('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
    instalar: ico18('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
    como: ico18('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 1 4 17zM20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a1.5 1.5 0 0 1 1.5-1.5h5a1.5 1.5 0 0 0 1.5-1.5z"/>'),
    tutorial: ico18('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17h.01"/>'),
    sair: ico18('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4"/>'),
  };
  const NOME_TEMA = { auto: 'automático', claro: 'claro', escuro: 'escuro' };
  function montaRodape(ag) {
    const pe = document.querySelector('aside#menu .pe');
    if (!pe || $('mlRodape')) return;
    const como = document.querySelector('#mlTabs .ml-tab[href*="#aba=como"]');
    const bt = (id, rot, svg) => `<button type="button" class="ml-rb" id="${id}" title="${rot}" aria-label="${rot}">${svg}</button>`;
    pe.insertAdjacentHTML('afterbegin', '<div class="ml-rodape" id="mlRodape">' +
      bt('mlRbTema', 'Tema', ICO_RODAPE.auto) + bt('mlRbInstalar', 'Instalar o app', ICO_RODAPE.instalar) +
      (como ? `<a class="ml-rb" href="${esc(como.getAttribute('href'))}" title="Como funciona" aria-label="Como funciona">${ICO_RODAPE.como}</a>` : '') +
      bt('mlRbTutorial', 'Tutorial do menu', ICO_RODAPE.tutorial) + '<span class="ml-resp"></span></div>');
    const rod = $('mlRodape'), form = $('formSair');
    if (form) {
      const sair = form.querySelector('button');
      if (sair) { sair.className = 'ml-rb'; sair.title = 'Sair'; sair.setAttribute('aria-label', 'Sair'); sair.innerHTML = ICO_RODAPE.sair; }
      rod.appendChild(form);
    }
    // a caixa de ajuda da instalação continua aparecendo, agora logo acima do rodapé
    const ajuda = $('mlInstalarAjuda');
    if (ajuda) pe.insertBefore(ajuda, rod);
    $('mlRbInstalar').onclick = () => $('mlInstalar').click();
    $('mlRbTutorial').onclick = () => { const t = $('gmTutorial'); if (t) t.click(); };
    $('mlRbTema').onclick = () => {
      if (!raiz.DGTema) return;
      const ordem = ['auto', 'claro', 'escuro'], atual = raiz.DGTema.preferencia();
      raiz.DGTema.escolhe(ordem[(ordem.indexOf(atual) + 1) % ordem.length]);
    };
    pintaRodape();
  }
  function pintaRodape() {
    const b = $('mlRbTema');
    if (b) {
      const pref = raiz.DGTema ? raiz.DGTema.preferencia() : 'auto';
      b.innerHTML = ICO_RODAPE[pref] || ICO_RODAPE.auto;
      b.title = 'Tema: ' + (NOME_TEMA[pref] || pref) + ' (toque para trocar)';
      b.setAttribute('aria-label', b.title);
    }
    const inst = $('mlRbInstalar'), orig = $('mlInstalar');
    if (inst && orig) inst.hidden = orig.hidden;
  }
  document.addEventListener('dgtema', pintaRodape);

  /* ── Celular: o menu desliza com o dedo ───────────────────────────────────
     Arrastar da borda esquerda puxa o menu, que acompanha o dedo; arrastar para a esquerda (no menu ou
     no véu) fecha. Soltar depois de um terço do caminho, ou num gesto rápido, completa; antes, volta.
     Abrir e fechar de verdade é o clique no ☰ e no véu, então cada tela segue com a própria lógica. */
  let deslizarLigado = false;
  function ligaDeslizar() {
    if (deslizarLigado) return;
    deslizarLigado = true;
    const menu = document.querySelector('aside#menu'), veu = $('overlayMenu');
    if (!menu || !veu) return;
    const gaveta = () => !(raiz.matchMedia && matchMedia('(min-width:1100px)').matches);
    let g = null;   // { modo: 'abrir'|'fechar', x0, y0, t0, w, dx, decidido }
    window.addEventListener('touchstart', ev => {
      if (!gaveta() || ev.touches.length !== 1 || $('tourCaixa') || document.querySelector('.ml-fs-veu:not([hidden])')) { g = null; return; }
      const t = ev.touches[0], aberto = menu.classList.contains('abre');
      if (!aberto && t.clientX <= 22) g = { modo: 'abrir' };
      else if (aberto && (menu.contains(ev.target) || ev.target === veu)) g = { modo: 'fechar' };
      else { g = null; return; }
      Object.assign(g, { x0: t.clientX, y0: t.clientY, t0: Date.now(), w: menu.getBoundingClientRect().width || 300, dx: 0, decidido: false });
    }, { passive: true, capture: true });
    window.addEventListener('touchmove', ev => {
      if (!g) return;
      const t = ev.touches[0], dx = t.clientX - g.x0, dy = t.clientY - g.y0;
      if (!g.decidido) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        // gesto mais vertical que horizontal (rolar a lista do menu): não é com a gente
        if (Math.abs(dy) > Math.abs(dx) || (g.modo === 'fechar' && dx > 0)) { g = null; return; }
        g.decidido = true;
        menu.style.transition = 'none';
        veu.style.transition = 'none';
        veu.style.display = 'block';
      }
      ev.stopPropagation();
      g.dx = dx;
      const pos = g.modo === 'abrir' ? Math.min(0, -g.w + Math.max(0, dx)) : Math.min(0, dx);
      menu.style.transform = `translateX(${pos}px)`;
      veu.style.opacity = String(Math.max(0, Math.min(1, 1 + pos / g.w)));
    }, { passive: true, capture: true });
    const solta = () => {
      if (!g) return;
      const feito = g.decidido, modo = g.modo, dx = g.dx, v = Math.abs(dx) / Math.max(1, Date.now() - g.t0), w = g.w;
      g = null;
      if (!feito) return;
      menu.style.transition = ''; menu.style.transform = '';
      veu.style.transition = ''; veu.style.opacity = ''; veu.style.display = '';
      const passou = Math.abs(dx) > w / 3 || v > 0.5;
      if (modo === 'abrir' && passou && dx > 0) $('btnMenu').click();
      if (modo === 'fechar' && passou && dx < 0) veu.click();
    };
    window.addEventListener('touchend', solta, { capture: true });
    window.addEventListener('touchcancel', solta, { capture: true });
  }

  /* ── Trocar a foto do agente (18/10/2026) ─────────────────────────────────
     Tocar na foto grande abre a folha "Trocar foto". Escolhida a foto, o dono a enquadra num
     círculo (arrastar, pinça, controle, roda do mouse, setas). Ao salvar, o quadrado do círculo
     vira um JPEG de 512 px aqui no aparelho (a foto do celular chega leve e já em pé) e sobe por
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

  const ICO_MENOR = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="m8 15 3-3 2 2 1-1 2 2"/></svg>';
  const ICO_MAIOR = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>';
  const ICO_CENTRO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>';
  const LADO_TRABALHO = 2048;   // menor lado da cópia de trabalho: dá 512 px nítidos mesmo no zoom 4x

  /* Lê a imagem (respeitando a rotação da câmera) numa tela de trabalho reduzida. A mesma tela é
     a que aparece no enquadramento e a que é recortada ao salvar, então o que se vê é o que sobe. */
  async function abreImagem(arquivo) {
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
      if (!w || !h) throw new Error('imagem sem tamanho');
      const k = Math.min(1, LADO_TRABALHO / Math.min(w, h), 4 * LADO_TRABALHO / Math.max(w, h));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
      const cx = cv.getContext('2d');
      cx.fillStyle = '#fff';   // PNG transparente vira fundo branco, não preto
      cx.fillRect(0, 0, cv.width, cv.height);
      cx.drawImage(fonte, 0, 0, cv.width, cv.height);
      return cv;
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (fonte && fonte.close) fonte.close();
    }
  }

  /* O quadrado do círculo, do jeito que está enquadrado, num JPEG de 512 px. */
  async function fotoEnquadrada() {
    const tela = folha.tela, a = ajusteTela(folha.ajuste), r = recorteDoAjuste(a);
    const lado = Math.max(1, Math.min(512, Math.round(r.lado)));
    const cv = document.createElement('canvas');
    cv.width = cv.height = lado;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, lado, lado);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(tela, r.sx, r.sy, r.lado, r.lado, 0, 0, lado, lado);
    const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.9));
    if (!blob) throw new Error('o navegador não gerou a imagem');
    return blob;
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
      '<div class="ml-fs-corte" id="mlFotoCorte" tabindex="0" role="group" aria-roledescription="enquadramento" ' +
      'aria-label="Enquadrar a foto. Setas movem a foto; mais e menos aproximam e afastam." hidden>' +
      '<div class="ml-fs-mascara" aria-hidden="true"></div></div>' +
      '<p class="ml-fs-ajuste" id="mlFotoAjuste" hidden><b>Ajustar:</b> arraste para posicionar e use o controle para aproximar.</p>' +
      '<div class="ml-fs-zoom" id="mlFotoZoomLinha" hidden>' +
      `<label for="mlFotoZoom" class="ml-fs-oculto">Aproximar a foto</label>${ICO_MENOR}` +
      `<input type="range" id="mlFotoZoom" min="1" max="${ZOOM_MAX}" step="0.01" value="1">${ICO_MAIOR}` +
      `<button type="button" class="ml-fs-x ml-fs-centro" data-fs="centralizar" aria-label="Voltar ao enquadramento inicial" title="Voltar ao início">${ICO_CENTRO}</button></div>` +
      `<button type="button" class="ml-fs-btn" data-fs="escolher">${ICO_IMAGEM}<span>Escolher foto</span></button>` +
      '<input type="file" id="mlFotoArq" accept="image/*" hidden>' +
      '<p class="ml-fs-dica" id="mlFotoDica">PNG, JPEG ou WebP. Depois você ajusta o enquadramento.</p>' +
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
      else if (acao === 'centralizar') { folha.ajuste = null; pintaCorte(); }
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
        folha.tela = await abreImagem(f);
      } catch (e) {
        console.warn('menu-lado: não consegui abrir a foto escolhida:', e.message);
        folha.tela = null;
        pintaPrevia();
        return erroFoto('Não consegui abrir essa foto. Escolha uma foto PNG, JPEG ou WebP.');
      }
      folha.ajuste = null;
      pintaPrevia();
      $('mlFotoCorte').focus({ preventScroll: true });
    });
    ligaCorte();
    return veu;
  }

  const folha = { ag: null, tela: null, ajuste: null, ocupado: false, voltaFoco: null };

  /* O ajuste guardado vale para o tamanho atual do quadro (se o quadro mudou, recomeça centrado). */
  function ajusteTela(a) {
    const lado = $('mlFotoCorte').clientWidth || 248, t = folha.tela;
    if (!a || a.lado !== lado || a.w !== t.width || a.h !== t.height) return ajusteInicial(t.width, t.height, lado);
    return a;
  }

  function pintaCorte() {
    if (!folha.tela) return;
    const a = folha.ajuste = ajusteTela(folha.ajuste), t = folha.tela;
    const e = escalaCobre(a.w, a.h, a.lado) * a.zoom;
    t.style.width = (a.w * e) + 'px';
    t.style.height = (a.h * e) + 'px';
    t.style.transform = `translate(${a.x}px, ${a.y}px)`;
    const z = $('mlFotoZoom');
    z.value = String(a.zoom);
    z.setAttribute('aria-valuetext', Math.round(a.zoom * 100) + '%');
  }

  /* Arrastar, pinça, roda do mouse, controle e teclado mexem no mesmo folha.ajuste. */
  function ligaCorte() {
    const area = $('mlFotoCorte'), dedos = new Map();
    const ponto = ev => { const r = area.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const muda = fn => { if (!folha.tela || folha.ocupado) return; folha.ajuste = fn(ajusteTela(folha.ajuste)); pintaCorte(); };
    area.addEventListener('pointerdown', ev => {
      if (!folha.tela || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      ev.preventDefault();
      try { area.setPointerCapture(ev.pointerId); } catch (_) { /* ponteiro já solto */ }
      dedos.set(ev.pointerId, ponto(ev));
      area.classList.add('arrastando');
    });
    area.addEventListener('pointermove', ev => {
      const antes = dedos.get(ev.pointerId);
      if (!antes) return;
      const agora = ponto(ev);
      if (dedos.size === 1) muda(a => moveAjuste(a, agora.x - antes.x, agora.y - antes.y));
      else if (dedos.size === 2) {
        // pinça: o outro dedo fica parado neste evento; zoom pela distância, mover pelo ponto do meio
        const outro = [...dedos.entries()].find(([id]) => id !== ev.pointerId)[1];
        const d0 = Math.hypot(antes.x - outro.x, antes.y - outro.y), d1 = Math.hypot(agora.x - outro.x, agora.y - outro.y);
        const m0 = { x: (antes.x + outro.x) / 2, y: (antes.y + outro.y) / 2 }, m1 = { x: (agora.x + outro.x) / 2, y: (agora.y + outro.y) / 2 };
        muda(a => zoomNoPonto(moveAjuste(a, m1.x - m0.x, m1.y - m0.y), a.zoom * (d0 > 0 ? d1 / d0 : 1), m1.x, m1.y));
      }
      dedos.set(ev.pointerId, agora);
    });
    const solta = ev => { dedos.delete(ev.pointerId); if (!dedos.size) area.classList.remove('arrastando'); };
    area.addEventListener('pointerup', solta);
    area.addEventListener('pointercancel', solta);
    area.addEventListener('lostpointercapture', solta);
    area.addEventListener('wheel', ev => {
      if (!folha.tela) return;
      ev.preventDefault();
      const p = ponto(ev);
      muda(a => zoomNoPonto(a, a.zoom * Math.exp(-ev.deltaY * 0.0015), p.x, p.y));
    }, { passive: false });
    area.addEventListener('keydown', ev => {
      const passo = ev.shiftKey ? 32 : 8, k = ev.key;
      const mov = { ArrowLeft: [passo, 0], ArrowRight: [-passo, 0], ArrowUp: [0, passo], ArrowDown: [0, -passo] }[k];
      if (mov) muda(a => moveAjuste(a, mov[0], mov[1]));
      else if (k === '+' || k === '=') muda(a => zoomNoPonto(a, a.zoom * 1.1, a.lado / 2, a.lado / 2));
      else if (k === '-' || k === '_') muda(a => zoomNoPonto(a, a.zoom / 1.1, a.lado / 2, a.lado / 2));
      else if (k === '0') muda(a => ajusteInicial(a.w, a.h, a.lado));
      else return;
      ev.preventDefault();
    });
    $('mlFotoZoom').addEventListener('input', ev => muda(a => zoomNoPonto(a, Number(ev.target.value), a.lado / 2, a.lado / 2)));
  }

  function erroFoto(texto) {
    const e = $('mlFotoErro');
    e.textContent = texto;
    e.hidden = !texto;
  }

  function pintaPrevia() {
    const ag = folha.ag, pv = $('mlFotoPrevia'), corte = $('mlFotoCorte'), tem = !!folha.tela;
    pv.hidden = tem;
    pv.style.background = ag.cor || '#2f9e5e';
    pv.innerHTML = fotoDe(ag);
    corte.hidden = !tem;
    $('mlFotoAjuste').hidden = !tem;
    $('mlFotoZoomLinha').hidden = !tem;
    $('mlFotoDica').hidden = tem;
    if (tem && folha.tela.parentNode !== corte) {
      corte.querySelectorAll('canvas').forEach(c => c.remove());
      folha.tela.className = 'ml-fs-tela';
      folha.tela.setAttribute('aria-hidden', 'true');
      corte.insertBefore(folha.tela, corte.firstChild);
    }
    if (!tem) corte.querySelectorAll('canvas').forEach(c => c.remove());
    if (tem) pintaCorte();
    const temFoto = !!(ag.avatar_img || /^https:\/\//i.test(ag.avatar || ''));
    const veu = $('mlFotoVeu');
    veu.querySelector('[data-fs="salvar"]').disabled = folha.ocupado || !tem;
    veu.querySelector('[data-fs="remover"]').hidden = !temFoto || tem;
    veu.querySelector('[data-fs="escolher"] span').textContent = (temFoto || tem) ? 'Escolher outra foto' : 'Escolher foto';
    veu.querySelectorAll('[data-fs]').forEach(b => { if (b.dataset.fs !== 'salvar') b.disabled = folha.ocupado; });
    $('mlFotoZoom').disabled = folha.ocupado;
  }

  function abreFolhaFoto(ag) {
    const veu = folhaFoto();
    Object.assign(folha, { ag, tela: null, ajuste: null, ocupado: false, voltaFoco: document.activeElement });
    $('mlFotoSub').textContent = 'A foto de ' + ag.nome + ' aparece na conversa, no menu e no painel.';
    erroFoto('');
    veu.hidden = false;
    pintaPrevia();
    requestAnimationFrame(() => veu.classList.add('aberto'));
    veu.querySelector('.ml-fs').focus();   // o foco entra na folha sem acender o anel no botão
  }

  function fechaFolhaFoto() {
    const veu = $('mlFotoVeu');
    if (!veu || veu.hidden || folha.ocupado) return;
    veu.classList.remove('aberto');
    veu.hidden = true;
    folha.tela = null; folha.ajuste = null;
    $('mlFotoCorte').querySelectorAll('canvas').forEach(c => c.remove());
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
  async function salvaFoto() {
    if (!folha.tela) return;
    let blob;
    try { blob = await fotoEnquadrada(); } catch (e) {
      console.warn('menu-lado: não consegui recortar a foto:', e.message);
      return erroFoto('Não consegui preparar a foto. Escolha a foto de novo.');
    }
    enviaFoto('PUT', blob);
  }
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

  /* Ícones do menu (18/10/2026, pedido do dono): os itens nascem com um símbolo de texto (◔ ▦ ⏰...),
     que destoava do resto (o ⏰ virava emoji colorido). Aqui cada símbolo vira um ícone de traço fino,
     no estilo dos botões do topo (icones-topo.js). Um observador troca sempre que o menu é redesenhado. */
  const ico = d => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICONES_MENU = {
    '◔': ico('<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L4 21l1.4-4.6A8.5 8.5 0 1 1 21 12z"/>'),
    '▦': ico('<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9.5h16M9.5 9.5V20"/>'),
    '⏰': ico('<path d="M18 16v-5a6 6 0 0 0-12 0v5l-1.5 2h15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    '⧉': ico('<path d="M9 7V4M15 7V4M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v4"/>'),
    '⤓': ico('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
    '◉': ico('<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>'),
    '✦': ico('<path d="M12 3l2.4 5.3 5.6.7-4.1 3.9 1 5.6L12 15.8 7.1 18.5l1-5.6L4 9l5.6-.7z"/>'),
    '↻': ico('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
    '⚿': ico('<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>'),
    '▢': ico('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
    '▤': ico('<path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.3A3 3 0 0 0 8 18a2.5 2.5 0 0 0 4 1.5V5.5A2.5 2.5 0 0 0 9 4.5zM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.3A3 3 0 0 1 16 18a2.5 2.5 0 0 1-4 1.5"/>'),
    '⚙': ico('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
    '◇': ico('<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.6-1.5-2.8-1.5-1.6 0-2.8.9-2.8 2.1 0 2.8 5.6 1.6 5.6 4.4 0 1.2-1.2 2.1-2.8 2.1-1.3 0-2.4-.6-2.9-1.6M12 6v1.7M12 16.3V18"/>'),
    '◎': ico('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'),
    '◈': ico('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14.5 10h3M14.5 13.5h3"/>'),
    '◐': ico('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>'),
    '▨': ico('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
    '✚': ico('<path d="M12 21s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.5 2.7C19.5 16.4 12 21 12 21z"/><path d="M12 11v4M10 13h4"/>'),
    '•': ico('<circle cx="12" cy="12" r="2.5"/>'),
    '🔔': ico('<path d="M4 10v4h3l6 4V6L7 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>'),
    '🖥': ico('<rect x="3.5" y="4.5" width="17" height="11.5" rx="2"/><path d="M9 20h6M12 16v4"/>'),
    '🔖': ico('<path d="M7 4h10a1.5 1.5 0 0 1 1.5 1.5V20L12 15.5 5.5 20V5.5A1.5 1.5 0 0 1 7 4z"/>'),
    '📥': ico('<path d="M4 13h4l1.5 2.5h5L16 13h4"/><path d="M5.5 5h13L20 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V13z"/>'),
  };
  // o tema usa ◐ também: lá vira sol e lua, não carinha
  const ICONE_TEMA = ico('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>');
  function trocaIconesMenu() {
    document.querySelectorAll('.ml-ico:not([data-svg])').forEach(el => {
      const g = (el.textContent || '').trim().replace(/️/g, '');
      const svg = el.closest('.ml-tema') ? ICONE_TEMA : ICONES_MENU[g];
      if (!svg) return;
      el.dataset.svg = g; el.innerHTML = svg;
    });
  }
  if (typeof MutationObserver === 'function') {
    let pend = false;
    const olha = () => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; trocaIconesMenu(); }); };
    const liga = () => { trocaIconesMenu(); if (document.body) new MutationObserver(olha).observe(document.body, { childList: true, subtree: true }); };
    if (document.body) liga(); else document.addEventListener('DOMContentLoaded', liga);
  }
  // o seletor nasce com a casca (que monta depois); pinta assim que ele existir
  (function espera(n) { if (document.querySelector('#mlTema [data-tema-op]')) pintaTema(); else if (n > 0) setTimeout(() => espera(n - 1), 200); })(25);

  return { GRUPOS, grupoDe, corUso, quandoZeraUso, miniBarraUso, itemUso, ABAS_PAINEL, LINK_LEMBRETES, LINK_AVISOS, linkSessoes, itemAgente, linksPainel, linksExtras, comAgente, chaveDoHref, passosMenu, instrucaoInstalar, recorteQuadrado, problemaArquivo, ZOOM_MAX, escalaCobre, limitaAjuste, ajusteInicial, moveAjuste, zoomNoPonto, recorteDoAjuste, inicia, marca, extras, abreFolhaFoto, atualizaCaixa, defineNaoLidas, totalNaoLidas, totalPrecisam, seloDe };
});
