'use strict';
/* avisos.js: a tela do quadro de avisos entre agentes (rota /avisos e aba "Avisos" da Mesa de tarefas).

   Parte pura (sem DOM, com teste em web/test/avisos-tela.test.js): rótulos de dia, agrupamento,
   HTML de um aviso, resumo das entregas, validação do formulário e query dos filtros.
   Parte com DOM: window.DGAvisos.montar(elemento). Fala com /api/v1/avisos (contrato em docs/QUADRO-DE-AVISOS.md). */
(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else {
    raiz.DGAvisos = m;
    m.registra();
  }
})(this, function (raiz) {
  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TIPOS = [
    ['decisao', 'decisão'], ['preferencia', 'preferência'], ['entrega', 'entrega'],
    ['aprendizado', 'aprendizado'], ['referencia', 'referência'], ['pedido', 'pedido'],
    ['resumo_do_dia', 'resumo do dia'],
  ];
  const ROTULO_TIPO = Object.fromEntries(TIPOS);
  const ico = (d, t) => `<svg viewBox="0 0 24 24" width="${t || 16}" height="${t || 16}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICO = {
    tipo: ico('<path d="M4 7h16M4 12h10M4 17h7"/>'), aj: ico('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>', 18),
    enviar: ico('<path d="M12 19V5M6 11l6-6 6 6"/>', 18), dn: ico('<path d="m6 9 6 6 6-6"/>', 13), dia: ico('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
    ok: ico('<path d="m5 12 4.5 4.5L19 7"/>', 13), espera: ico('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 1.5"/>', 13), falha: ico('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>', 13),
    mais: ico('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  };
  const MAX_TEXTO = 280, MAX_LINHAS = 2, MAX_LINK = 500, MAX_ASSUNTO = 60;
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const p2 = n => String(n).padStart(2, '0');

  function data(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  const chaveDia = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());

  function hora(iso) {
    const d = data(iso);
    return d ? p2(d.getHours()) + ':' + p2(d.getMinutes()) : '';
  }

  /* "Hoje", "Ontem" ou "sex, 16/10" */
  function rotuloDia(iso, agora) {
    const d = data(iso);
    if (!d) return 'Sem data';
    const ref = agora ? new Date(agora) : new Date();
    const ontem = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1);
    if (chaveDia(d) === chaveDia(ref)) return 'Hoje';
    if (chaveDia(d) === chaveDia(ontem)) return 'Ontem';
    return DIAS[d.getDay()] + ', ' + p2(d.getDate()) + '/' + p2(d.getMonth() + 1);
  }

  /* Mantém a ordem recebida (do mais novo para o mais velho). */
  function agruparPorDia(avisos, agora) {
    const grupos = [];
    const por = new Map();
    for (const a of avisos || []) {
      const d = data(a.criado_em);
      const chave = d ? chaveDia(d) : 'sem-data';
      if (!por.has(chave)) {
        const g = { dia: chave, rotulo: rotuloDia(a.criado_em, agora), avisos: [] };
        por.set(chave, g);
        grupos.push(g);
      }
      por.get(chave).avisos.push(a);
    }
    return grupos;
  }

  function nomeDe(slug, agentes) {
    if (slug === 'dono') return 'Você';
    if (slug === 'todos') return 'todos';
    const a = (agentes || []).find(x => x.slug === slug || x.id === slug);
    return (a && a.nome) || slug;
  }

  function paraQuem(aviso, agentes) {
    const p = Array.isArray(aviso.para) && aviso.para.length ? aviso.para : ['todos'];
    if (p.includes('todos')) return 'todos';
    return p.map(s => nomeDe(s, agentes)).join(', ');
  }

  /* Uma frase por destinatário: chegou, recado entregue ou falhou. */
  function resumirEntregas(aviso) {
    const e = aviso && aviso.entregas;
    if (!e || typeof e !== 'object') return [];
    const out = [];
    for (const slug of Object.keys(e)) {
      const x = e[slug] || {};
      if (x.erro) out.push({ slug, estado: 'falha', texto: 'falhou para ' + slug + ': ' + x.erro });
      else if (x.recado_em) out.push({ slug, estado: 'recado', texto: 'recado entregue a ' + slug + ' às ' + hora(x.recado_em) });
      else if (x.retrato_em) out.push({ slug, estado: 'ok', texto: 'chegou para ' + slug + ' às ' + hora(x.retrato_em) });
      else out.push({ slug, estado: 'espera', texto: 'ainda não chegou para ' + slug });
    }
    return out;
  }

  const linkSeguro = u => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u);

  function motivoSituacao(a) {
    if (a.retirado_em) {
      return 'Retirado' + (a.retirado_por ? ' por ' + a.retirado_por : '') + ' às ' + hora(a.retirado_em) +
        (a.motivo_retirada ? ': ' + a.motivo_retirada : '');
    }
    if (a.substituido_por) return 'Substituído pelo aviso #' + a.substituido_por;
    if (a.ativo === false) return 'Fora da lista dos agentes';
    return '';
  }

  /* O aviso como linha, no estilo das abas Hoje e Tarefas (21/10/2026, pedido do dono): a foto de quem mandou,
     "Data → Tech", o tipo numa etiqueta discreta, a hora, o texto e se chegou. Retirar fica no "⋯".
     opcoes: { agentes, fotos: {slug: html}, motivoAberto: id do aviso com o campo de motivo aberto, menuAberto: id } */
  function htmlAviso(a, opcoes) {
    const o = opcoes || {};
    const inativo = a.ativo === false || !!a.retirado_em || !!a.substituido_por;
    const tipo = ROTULO_TIPO[a.tipo] ? a.tipo : 'outro';
    const rotulo = a.tipo_rotulo || ROTULO_TIPO[a.tipo] || a.tipo || 'aviso';
    const autor = a.agente === 'dono' ? 'Você' : (a.agente_nome || nomeDe(a.agente, o.agentes));
    const sit = motivoSituacao(a);
    const entregas = resumirEntregas(a);
    const tags = (Array.isArray(a.tags) ? a.tags : []).map(t => `<span class="av-tag">#${esc(t)}</span>`).join('');
    const assunto = a.assunto ? `<span class="av-assunto">${esc(a.assunto)}</span>` : '';
    const link = a.link && linkSeguro(a.link)
      ? `<a class="av-link" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.link)}</a>` : '';
    const foto = (o.fotos && o.fotos[a.agente]) || `<span class="av-foto">${esc(Array.from(autor || '?')[0])}</span>`;
    const ent = entregas.length ? (() => {
      const ruim = entregas.filter(e => e.estado === 'falha'), falta = entregas.filter(e => e.estado === 'espera');
      const quem = l => l.map(e => nomeDe(e.slug, o.agentes)).join(', ');
      if (ruim.length) return `<span class="av-ent falha">${ICO.falha}${esc(ruim.map(e => e.texto).join('; '))}</span>`;
      if (falta.length) return `<span class="av-ent espera">${ICO.espera}ainda não chegou para ${esc(quem(falta))}</span>`;
      return `<span class="av-ent ok" title="${esc(entregas.map(e => e.texto).join('; '))}">${ICO.ok}chegou para ${esc(quem(entregas))}</span>`;
    })() : '';
    const retirar = !inativo && o.retirar !== false
      ? `<span class="av-menu"><button type="button" class="av-mais" data-av-menu="${esc(a.id)}" aria-label="Mais ações" title="Mais ações">${ICO.mais}</button>` +
        (String(o.menuAberto) === String(a.id) ? `<span class="av-menu-op"><button type="button" class="av-btn av-mini" data-av-retirar="${esc(a.id)}">Retirar</button></span>` : `<button type="button" class="av-vh" data-av-retirar="${esc(a.id)}" tabindex="-1" aria-hidden="true"></button>`) +
        '</span>' : '';
    const campo = o.motivoAberto != null && String(o.motivoAberto) === String(a.id)
      ? `<form class="av-retirada" data-av-retirada="${esc(a.id)}">` +
        '<input name="motivo" type="text" maxlength="200" placeholder="Motivo (opcional)" aria-label="Motivo da retirada">' +
        '<button type="submit" class="av-btn av-perigo">Confirmar a retirada</button>' +
        `<button type="button" class="av-btn" data-av-cancela="${esc(a.id)}">Cancelar</button></form>` : '';
    return `<article class="av-aviso av-t-${tipo}${inativo ? ' av-apagado' : ''}" data-av-id="${esc(a.id)}">${foto}<div class="av-corpo">` +
      `<header class="av-topo"><b class="av-autor">${esc(autor)}</b><span class="av-para">→ ${esc(paraQuem(a, o.agentes))}</span>` +
      `<span class="av-tipo">${esc(rotulo)}</span><span class="av-hora">${esc(hora(a.criado_em))}</span></header>` +
      `<p class="av-texto">${esc(a.texto)}</p>` +
      (link || assunto || tags ? `<p class="av-linha">${assunto}${tags}${link}</p>` : '') +
      (sit ? `<p class="av-situacao">${esc(sit)}</p>` : '') +
      `<div class="av-pe">${ent}${retirar}</div>` + campo + '</div></article>';
  }

  function htmlLista(avisos, opcoes) {
    return agruparPorDia(avisos, opcoes && opcoes.agora).map(g =>
      `<section class="av-dia"><h3 class="av-dia-t">${ICO.dia}${esc(g.rotulo)}<span class="q">${g.avisos.length}</span></h3>` +
      `<div class="av-grupo">${g.avisos.map(a => htmlAviso(a, opcoes)).join('')}</div></section>`).join('');
  }

  /* f = { tipo, para: [slugs] | 'todos', texto, link, assunto }. Devolve { ok, erros:{campo:msg}, dados }. */
  function validaForm(f) {
    const erros = {};
    const tipo = String(f.tipo || '');
    const texto = String(f.texto == null ? '' : f.texto).replace(/\s+$/, '').replace(/^\s+/, '');
    const link = String(f.link || '').trim();
    const assunto = String(f.assunto || '').trim();
    let para = Array.isArray(f.para) ? f.para.filter(Boolean) : (f.para && f.para !== 'todos' ? [f.para] : []);
    if (!ROTULO_TIPO[tipo]) erros.tipo = 'Escolha o tipo do aviso.';
    if (!texto) erros.texto = 'Escreva o texto do aviso.';
    else if (texto.length > MAX_TEXTO) erros.texto = 'O texto passou de ' + MAX_TEXTO + ' caracteres (tem ' + texto.length + ').';
    else if (texto.split(/\r?\n/).length > MAX_LINHAS) erros.texto = 'Use no máximo ' + MAX_LINHAS + ' linhas.';
    if (link && !linkSeguro(link)) erros.link = 'O link precisa começar com http:// ou https://.';
    else if (link.length > MAX_LINK) erros.link = 'O link passou de ' + MAX_LINK + ' caracteres.';
    if (assunto.length > MAX_ASSUNTO) erros.assunto = 'O assunto passou de ' + MAX_ASSUNTO + ' caracteres.';
    if (tipo === 'pedido' && !para.length) erros.para = 'Um pedido precisa de destinatário: escolha para quem.';
    if (!para.length) para = ['todos'];
    const dados = { tipo, para, texto };
    if (link) dados.link = link;
    if (assunto) dados.assunto = assunto;
    return { ok: Object.keys(erros).length === 0, erros, dados };
  }

  /* A resposta 400 traz `erros` como objeto {campo: frase} ou lista; devolve sempre {campo: frase}. */
  function errosDaApi(erros) {
    const out = {};
    if (Array.isArray(erros)) {
      erros.forEach(e => {
        if (e && typeof e === 'object') out[e.campo || 'geral'] = e.erro || e.mensagem || JSON.stringify(e);
        else out.geral = (out.geral ? out.geral + ' ' : '') + String(e);
      });
    } else if (erros && typeof erros === 'object') {
      for (const k of Object.keys(erros)) out[k] = Array.isArray(erros[k]) ? erros[k].join(' ') : String(erros[k]);
    }
    return out;
  }

  function queryFiltros(f) {
    const p = [];
    if (f && f.agente) p.push('agente=' + encodeURIComponent(f.agente));
    if (f && f.tipo) p.push('tipo=' + encodeURIComponent(f.tipo));
    if (f && f.retirados) p.push('incluir_retirados=1');
    return p.length ? '?' + p.join('&') : '';
  }

  const maiorId = avisos => (avisos || []).reduce((m_, a) => Math.max(m_, Number(a.id) || 0), 0);

  const puros = {
    TIPOS, esc, rotuloDia, agruparPorDia, hora, paraQuem, resumirEntregas, htmlAviso, htmlLista,
    validaForm, errosDaApi, queryFiltros, maiorId, linkSeguro,
  };

  if (!raiz.document) return puros;

  /* ── Parte com DOM ─────────────────────────────────────────────────────── */
  const INTERVALO = 15000;
  const q = (r, s) => r.querySelector(s);

  const PASSOS = {
    pagina: [
      { alvo: '[data-av-tour="titulo"]', titulo: 'O quadro de avisos',
        oque: 'É o mural onde os seus agentes contam uns aos outros, em uma ou duas linhas, o que os outros precisam saber: uma decisão sua, uma preferência, uma entrega, um aprendizado.',
        como: 'Os agentes postam pela caixa deles. Você posta aqui. O S2 Bot guarda o aviso e regrava o quadro na casa de cada agente que pode vê-lo.',
        porque: 'Sem o quadro, cada agente descobriria as coisas sozinho, e você teria de repetir a mesma decisão para cada um.' },
    ],
    postar: [
      { alvo: '[data-av-tour="postar"]', titulo: 'Postar um aviso',
        oque: 'O formulário para você avisar os agentes. O aviso sai com o seu nome ("Você") e não tem limite de frequência.',
        como: 'Escolha o tipo, para quem vai (todos ou só alguns), escreva até 280 caracteres em até 2 linhas e, se quiser, ponha um link e um assunto.',
        porque: 'Quando você decide algo que vale para mais de um agente, postar aqui é mais rápido do que avisar um por um.' },
      { alvo: '[data-av-tour="para"]', titulo: 'Para quem',
        oque: 'Todos ou agentes escolhidos. Avisos para todos ficam disponíveis a cada agente na próxima mensagem dele.',
        como: 'Quando o aviso é endereçado a agentes específicos, o Web também manda um recado pelo runner de cada um, que entra no próximo turno livre.',
        porque: 'O recado direto só existe para aviso endereçado. Se fosse para todos, cada postagem interromperia todos os agentes, e o quadro viraria barulho.' },
      { alvo: '[data-av-tour="texto"]', titulo: 'O texto',
        oque: 'O aviso em si, de até 280 caracteres e 2 linhas.',
        como: 'O contador mostra quanto falta. O detalhe longo vai em um arquivo ou página, e você põe o endereço no campo de link.',
        porque: 'O texto é injetado na conversa dos agentes. Curto, ele cabe sem gastar o contexto deles.' },
    ],
    filtros: [
      { alvo: '[data-av-tour="filtros"]', titulo: 'Filtros',
        oque: 'Escolhe quais avisos aparecem: de quem veio, de que tipo e se os retirados entram na lista.',
        como: 'Cada mudança busca de novo no servidor. Sem filtro, a tela mostra os últimos 7 dias.',
        porque: 'Com vários agentes postando, o filtro ajuda a achar, por exemplo, só as decisões ou só o que a Marina avisou.' },
    ],
    lista: [
      { alvo: '[data-av-tour="lista"]', titulo: 'Os avisos',
        oque: 'Os avisos por dia, do mais novo para o mais velho, com tipo, autor, hora, destinatários, link, assunto e a situação das entregas.',
        como: 'A lista se atualiza sozinha a cada 15 segundos e pausa quando a aba está escondida. "Chegou para..." quer dizer que o quadro foi gravado na casa do agente. "Recado entregue" quer dizer que ele também foi cutucado.',
        porque: 'Aqui você confere se a mensagem chegou de fato. Só aparece o que os agentes postam pela caixa e o que você posta nesta tela.' },
      { alvo: '[data-av-tour="lista"]', titulo: 'Retirar um aviso',
        oque: 'O botão "Retirar" tira o aviso da leitura dos agentes. Ele não apaga nada.',
        como: 'Você pode dizer o motivo. O aviso fica na lista, apagado, com quem retirou e por quê. Um aviso corrigido por outro também aparece apagado.',
        porque: 'Manter o registro deixa claro o que valeu e quando mudou, e permite conferir depois por que um agente agiu de certo jeito.' },
    ],
  };

  const estado = { agentes: [], tipos: TIPOS, avisos: [], ultimoId: 0, abertoRetirar: null, menuAberto: null, fotos: {}, filtro: { agente: '', tipo: '', retirados: false } };
  let setBolinha = null, visto = 0, raizEl = null, timer = null, carregou = false, busca = 0, espia = null;
  // O maior id já visto fica no aparelho: assim a aba da Mesa acende a bolinha antes de ser aberta.
  const CHAVE_VISTO = 'dgclaw.avisos.visto';
  try { visto = Number(localStorage.getItem(CHAVE_VISTO)) || 0; } catch (_) { /* sem localStorage: começa do zero */ }
  function guardaVisto(v) {
    visto = v;
    try { localStorage.setItem(CHAVE_VISTO, String(v)); } catch (_) { /* sem localStorage: fica só na memória */ }
  }
  // Antes da aba ser montada, uma consulta leve por minuto só para a bolinha.
  async function espiar() {
    try {
      const r = await fetch('/api/v1/avisos?limite=1', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const d = await r.json();
      if (typeof d.cursor === 'number' && d.cursor > visto) bolinha(true);
    } catch (e) { console.warn('Quadro de avisos: não consegui conferir se há aviso novo:', e && e.message); }
  }

  function bolinha(arg) {
    if (typeof arg === 'function') { setBolinha = arg; return; }
    if (setBolinha) setBolinha(!!arg);
  }

  function tela() {
    return `<div class="av-tela bh">
<header class="av-cab" data-av-tour="titulo"><h1>Quadro de avisos</h1>
<button type="button" class="av-btn" data-av-tutorial="pagina">Tutorial</button></header>
<p id="avStatus" class="av-status" role="status" aria-live="polite"></p>
<form id="avForm" class="bh-novo av-novo" novalidate data-av-tour="postar">
<textarea id="avTexto" name="texto" rows="2" maxlength="400" placeholder="Escreva um aviso para os agentes: a partir de hoje, relatórios saem em PDF" data-av-tour="texto"></textarea>
<p class="av-erro" data-erro="texto" hidden></p>
<div class="bh-acoes">
<label class="av-pil">${ICO.tipo}<select id="avTipo" name="tipo" aria-label="Tipo do aviso"></select>${ICO.dn}</label>
<span class="av-dest" data-av-tour="para"><button type="button" class="av-pil" id="avParaBtn" aria-haspopup="true" aria-expanded="false">para <span id="avParaFotos" class="av-fotos"></span><span id="avParaTx">todos</span>${ICO.dn}</button>
<div id="avPara" class="av-para-menu" role="group" aria-label="Para quem" hidden></div></span>
<button type="button" class="av-ic" id="avAjustes" aria-expanded="false" title="Link e assunto" aria-label="Link e assunto">${ICO.aj}</button>
<span class="av-cont"><span id="avCont">0/${MAX_TEXTO}</span></span>
<button type="submit" id="avPostar" class="av-go" title="Postar o aviso" aria-label="Postar o aviso">${ICO.enviar}</button></div>
<div class="av-mais-campos" id="avMaisCampos" hidden>
<label>Link (opcional)<input id="avLink" name="link" type="url" inputmode="url" autocomplete="off" placeholder="https://"></label><p class="av-erro" data-erro="link" hidden></p>
<label>Assunto (opcional)<input id="avAssunto" name="assunto" type="text" maxlength="80" autocomplete="off"></label><p class="av-erro" data-erro="assunto" hidden></p></div>
<p class="av-erro" data-erro="tipo" hidden></p><p class="av-erro" data-erro="para" hidden></p><p class="av-erro" data-erro="geral" hidden></p>
<p id="avResposta" class="bh-msg av-resposta" role="status" hidden></p>
</form>
<div class="av-filtros" data-av-tour="filtros" id="avFiltros"></div>
<div id="avLista" class="av-lista" aria-live="polite" data-av-tour="lista"></div></div>`;
  }

  function opcoesTipo(sel, comTodos) {
    return (comTodos ? '<option value="">Todos os tipos</option>' : '') +
      estado.tipos.map(t => `<option value="${esc(t[0] || t.id)}">${esc(t[1] || t.rotulo)}</option>`).join('');
  }

  // fotos dos agentes (GET /api/v1/agents): a lista de avisos traz só slug e nome
  async function carregaFotos() {
    try {
      const r = await fetch('/api/v1/agents', { credentials: 'same-origin', cache: 'no-store' });
      const d = r.ok ? await r.json() : null;
      (d && d.agentes || []).forEach(a => {
        const img = a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '');
        estado.fotos[a.id] = `<span class="av-foto" style="background:${esc(a.cor || '#5b6472')}">${img ? `<img src="${esc(img)}" alt="">` : esc(Array.from(a.avatar || a.nome || '?')[0])}</span>`;
      });
      estado.fotos.dono = '<span class="av-foto av-voce">Você</span>';
      if (raizEl) { pintaAgentes(); pintaFiltros(); if (carregou && !digitando()) pintaLista(); }
    } catch (_) { /* sem fotos: fica a inicial */ }
  }

  /* "para quem": Todos ou agentes escolhidos, num menu com as fotos (mesmos campos de antes: destino e para) */
  function pintaAgentes() {
    const r = raizEl;
    const lista = estado.agentes;
    const paraEl = q(r, '#avPara');
    const marcados = Array.from(paraEl.querySelectorAll('input[name=para]:checked')).map(i => i.value);
    const alguns = marcados.length > 0;
    paraEl.innerHTML = `<label class="av-op"><input type="radio" name="destino" value="todos"${alguns ? '' : ' checked'}> Todos os agentes</label>` +
      `<input type="radio" name="destino" value="alguns" hidden${alguns ? ' checked' : ''}>` +
      (lista.length ? lista.map(a => {
        const id = a.slug || a.id;
        return `<label class="av-op"><input type="checkbox" name="para" value="${esc(id)}"${marcados.includes(id) ? ' checked' : ''}>${estado.fotos[id] || ''}<span>${esc(a.nome || a.slug)}</span></label>`;
      }).join('') : '<span class="av-fraco">Nenhum agente de trabalho encontrado.</span>');
    pintaPara();
  }
  function pintaPara() {
    const r = raizEl;
    const marcados = Array.from(r.querySelectorAll('#avPara input[name=para]:checked')).map(i => i.value);
    const ids = marcados.length ? marcados : estado.agentes.map(a => a.slug || a.id);
    q(r, '#avParaFotos').innerHTML = ids.slice(0, 4).map(id => estado.fotos[id] || '').join('');
    q(r, '#avParaTx').textContent = marcados.length ? marcados.map(id => nomeDe(id, estado.agentes)).join(', ') : 'todos';
  }

  /* filtros em pílulas: tipo, retirados e as fotos para filtrar por quem mandou */
  function pintaFiltros() {
    const f = estado.filtro;
    const chip = (tipo, rot) => `<button type="button" class="av-chip${f.tipo === tipo ? ' on' : ''}" data-av-ftipo="${tipo}" aria-pressed="${f.tipo === tipo}">${rot}</button>`;
    const quem = [{ id: 'dono', nome: 'Você' }].concat(estado.agentes.map(a => ({ id: a.slug || a.id, nome: a.nome })));
    q(raizEl, '#avFiltros').innerHTML = `<div class="av-chips">${chip('', 'Todos')}${chip('pedido', 'Pedidos')}${chip('entrega', 'Entregas')}${chip('decisao', 'Decisões')}` +
      `<button type="button" class="av-chip${f.retirados ? ' on' : ''}" data-av-fretirados aria-pressed="${f.retirados}">Retirados</button></div>` +
      `<div class="av-fquem">${quem.filter(x => estado.fotos[x.id]).map(x => `<button type="button" class="av-fav${f.agente === x.id ? ' on' : ''}" data-av-fagente="${esc(x.id)}" aria-pressed="${f.agente === x.id}" title="Só os avisos de ${esc(x.nome)}">${estado.fotos[x.id]}</button>`).join('')}</div>`;
  }

  function mostraErro(campo, msg) {
    const e = q(raizEl, `[data-erro="${campo}"]`);
    if (!e) return false;
    e.textContent = msg || '';
    e.hidden = !msg;
    return true;
  }
  const limpaErros = () => raizEl.querySelectorAll('[data-erro]').forEach(e => { e.textContent = ''; e.hidden = true; });

  function status(msg, tipo) {
    const s = q(raizEl, '#avStatus');
    s.textContent = msg || '';
    s.className = 'av-status' + (tipo ? ' av-' + tipo : '');
  }

  function aoNaoAutorizado() {
    location.href = '/login?next=' + encodeURIComponent('/avisos');
  }

  async function api(metodo, url, corpo) {
    const init = { method: metodo, cache: 'no-store', headers: {} };
    if (corpo !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(corpo); }
    const r = await fetch(url, init);
    if (r.status === 401) { aoNaoAutorizado(); const e = new Error('Sessão expirada.'); e.status = 401; throw e; }
    let d = null;
    try { d = await r.json(); } catch (e) { d = null; }
    if (!r.ok || !d || d.ok === false) {
      const e = new Error((d && d.erro) || ('a API respondeu ' + r.status + ' sem explicação'));
      e.status = r.status;
      e.dados = d;
      throw e;
    }
    return d;
  }

  function pintaLista() {
    const caixa = q(raizEl, '#avLista');
    if (!estado.avisos.length) {
      caixa.innerHTML = '<p class="av-vazio">Nenhum aviso nos últimos 7 dias.</p>';
      return;
    }
    caixa.innerHTML = htmlLista(estado.avisos, { agentes: estado.agentes, fotos: estado.fotos, motivoAberto: estado.abertoRetirar, menuAberto: estado.menuAberto });
  }

  /* não troca a lista debaixo de quem está escrevendo o motivo da retirada */
  const digitando = () => !!q(raizEl, '#avLista .av-retirada input:focus');

  async function carrega(manual) {
    const minha = ++busca;
    if (!carregou) q(raizEl, '#avLista').innerHTML = '<p class="av-vazio">Carregando os avisos...</p>';
    try {
      const d = await api('GET', '/api/v1/avisos' + queryFiltros(estado.filtro));
      if (minha !== busca) return;
      if (Array.isArray(d.agentes)) { estado.agentes = d.agentes; if (!carregou) pintaAgentes(); else atualizaAgentes(); }
      if (Array.isArray(d.tipos) && d.tipos.length) {
        estado.tipos = d.tipos.map(t => Array.isArray(t) ? t : [t.id, t.rotulo]);
      }
      if (!carregou) q(raizEl, '#avTipo').innerHTML = opcoesTipo(null, false);
      estado.avisos = d.avisos || [];
      const maior = Math.max(maiorId(estado.avisos), Number(d.cursor) || 0);
      const aparente = raizEl.offsetParent !== null && document.visibilityState === 'visible';
      if (aparente || !carregou) guardaVisto(Math.max(visto, maior));
      else if (maior > visto) bolinha(true);
      if (aparente && maior >= visto) bolinha(false);
      carregou = true;
      status('');
      if (!digitando()) pintaLista();
    } catch (e) {
      if (minha !== busca || e.status === 401) return;
      const motivo = e.status === 503 ? 'O quadro está indisponível: ' + e.message
        : 'Não consegui carregar os avisos (' + (e.status ? 'erro ' + e.status : 'sem resposta do servidor') + '): ' + e.message;
      status(motivo, 'erro');
      if (!carregou || manual) {
        q(raizEl, '#avLista').innerHTML = `<p class="av-vazio av-erro-bloco" role="alert">${esc(motivo)} ` +
          '<button type="button" class="av-btn" data-av-recarrega>Tentar de novo</button></p>';
      }
    }
  }

  function atualizaAgentes() {
    if (q(raizEl, '#avPara').querySelectorAll('input[name=para]').length !== estado.agentes.length) { pintaAgentes(); pintaFiltros(); }
  }

  function dadosForm() {
    const f = q(raizEl, '#avForm');
    const destino = f.querySelector('input[name=destino]:checked');
    const para = destino && destino.value === 'alguns'
      ? Array.from(f.querySelectorAll('input[name=para]:checked')).map(i => i.value) : [];
    return { tipo: f.tipo.value, para, texto: f.texto.value, link: f.link.value, assunto: f.assunto.value };
  }

  async function posta(ev) {
    ev.preventDefault();
    limpaErros();
    const resp = q(raizEl, '#avResposta');
    resp.hidden = true;
    const bruto = dadosForm();
    const v = validaForm(bruto);
    if (bruto.para.length === 0 && q(raizEl, 'input[name=destino]:checked').value === 'alguns') {
      v.ok = false; v.erros.para = 'Marque pelo menos um agente, ou volte para "Todos".';
    }
    if (!v.ok) { Object.keys(v.erros).forEach(k => mostraErro(k, v.erros[k])); return; }
    const botao = q(raizEl, '#avPostar');
    botao.disabled = true;
    try {
      const d = await api('POST', '/api/v1/avisos', v.dados);
      const f = q(raizEl, '#avForm');
      f.texto.value = ''; f.link.value = ''; f.assunto.value = '';
      f.querySelector('input[name=destino][value=todos]').checked = true;
      f.querySelectorAll('input[name=para]').forEach(i => { i.checked = false; });
      pintaPara();
      contador();
      resp.textContent = 'Aviso #' + ((d.aviso && d.aviso.id) || '?') + ' postado.';
      resp.hidden = false;
      carrega();
    } catch (e) {
      if (e.status === 401) return;
      const porCampo = errosDaApi(e.dados && e.dados.erros);
      const campos = Object.keys(porCampo);
      let achou = false;
      campos.forEach(c => { if (c !== 'geral' && mostraErro(c, porCampo[c])) achou = true; });
      const extra = porCampo.geral || (!achou ? e.message + (e.status ? ' (erro ' + e.status + ')' : '') : '');
      if (e.status === 429 && e.dados && e.dados.tente_em) {
        mostraErro('geral', e.message + ' Tente de novo às ' + hora(e.dados.tente_em) + '.');
      } else if (extra) mostraErro('geral', extra);
      else if (e.message && e.status !== 400) mostraErro('geral', e.message);
    } finally { botao.disabled = false; }
  }

  async function retira(id, motivo) {
    try {
      const corpo = motivo ? { motivo } : {};
      await api('DELETE', '/api/v1/avisos/' + encodeURIComponent(id), corpo);
      estado.abertoRetirar = null;
      status('Aviso #' + id + ' retirado. Ele continua na lista, apagado.', 'ok');
      await carrega();
    } catch (e) {
      if (e.status === 401) return;
      status('Não consegui retirar o aviso #' + id + ' (erro ' + (e.status || 'sem resposta') + '): ' + e.message, 'erro');
    }
  }

  function contador() {
    const t = q(raizEl, '#avTexto').value;
    const c = q(raizEl, '#avCont');
    c.textContent = t.length + '/' + MAX_TEXTO;
    c.parentNode.classList.toggle('av-passou', t.length > MAX_TEXTO);
  }

  function tour(chave) {
    if (!window.DGTour) { status('O modo tutorial não carregou nesta página.', 'erro'); return; }
    let passos = chave === 'pagina'
      ? [].concat(PASSOS.pagina, PASSOS.postar, PASSOS.filtros, PASSOS.lista) : PASSOS[chave];
    // Na tela /avisos o título e o Tutorial moram no cabeçalho da casca e o .av-cab fica escondido: o passo do título aponta para lá.
    const cab = raizEl && raizEl.querySelector('.av-cab');
    if (chave === 'pagina' && cab && cab.offsetParent === null && document.getElementById('cabecalho')) {
      passos = passos.map(p => (p.alvo === '[data-av-tour="titulo"]' ? Object.assign({}, p, { alvo: '#cabecalho' }) : p));
    }
    window.DGTour.inicia({ passos });
  }

  function montar(elemento) {
    raizEl = elemento;
    elemento.classList.add('av-raiz');
    elemento.innerHTML = tela();
    carregou = false;
    q(elemento, '#avTipo').innerHTML = opcoesTipo(null, false);
    if (window.DGSeletorAgente) window.DGSeletorAgente.opcoes(q(elemento, '#avTipo'), { titulo: 'Tipo do aviso' });
    pintaAgentes(); pintaFiltros(); carregaFotos();
    q(elemento, '#avTexto').addEventListener('input', contador);
    q(elemento, '#avForm').addEventListener('submit', posta);
    elemento.addEventListener('change', ev => {
      const t = ev.target;
      if (t.name === 'destino' && t.value === 'todos') elemento.querySelectorAll('#avPara input[name=para]').forEach(i => { i.checked = false; });
      if (t.name === 'para') {
        const algum = !!elemento.querySelector('#avPara input[name=para]:checked');
        elemento.querySelector(`#avPara input[name=destino][value=${algum ? 'alguns' : 'todos'}]`).checked = true;
      }
      if (t.name === 'destino' || t.name === 'para') pintaPara();
    });
    elemento.addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.id === 'avParaBtn') { const m = q(elemento, '#avPara'); m.hidden = !m.hidden; b.setAttribute('aria-expanded', String(!m.hidden)); return; }
      if (b.id === 'avAjustes') { const m = q(elemento, '#avMaisCampos'); m.hidden = !m.hidden; b.classList.toggle('on', !m.hidden); b.setAttribute('aria-expanded', String(!m.hidden)); return; }
      if (b.dataset.avFtipo != null) { estado.filtro.tipo = b.dataset.avFtipo; pintaFiltros(); carrega(true); return; }
      if (b.hasAttribute('data-av-fretirados')) { estado.filtro.retirados = !estado.filtro.retirados; pintaFiltros(); carrega(true); return; }
      if (b.dataset.avFagente) { estado.filtro.agente = estado.filtro.agente === b.dataset.avFagente ? '' : b.dataset.avFagente; pintaFiltros(); carrega(true); return; }
      if (b.dataset.avMenu) { estado.menuAberto = String(estado.menuAberto) === b.dataset.avMenu ? null : b.dataset.avMenu; pintaLista(); return; }
      if (b.dataset.avTutorial) tour(b.dataset.avTutorial);
      else if (b.dataset.avRetirar) { estado.abertoRetirar = b.dataset.avRetirar; estado.menuAberto = null; pintaLista(); const i = q(elemento, '.av-retirada input'); if (i) i.focus(); }
      else if (b.dataset.avCancela) { estado.abertoRetirar = null; pintaLista(); }
      else if (b.hasAttribute('data-av-recarrega')) carrega(true);
    });
    elemento.addEventListener('submit', ev => {
      const f = ev.target.closest('form[data-av-retirada]');
      if (!f) return;
      ev.preventDefault();
      const botao = f.querySelector('button[type=submit]');
      botao.disabled = true;
      retira(f.dataset.avRetirada, f.motivo.value.trim());
    });
    // o menu "para quem" fecha ao tocar fora dele
    document.addEventListener('click', ev => {
      const m = q(elemento, '#avPara');
      if (m && !m.hidden && !ev.target.closest('.av-dest')) { m.hidden = true; q(elemento, '#avParaBtn').setAttribute('aria-expanded', 'false'); }
    });
    const tic = () => { if (document.visibilityState === 'visible' && raizEl.isConnected) carrega(); };
    clearInterval(espia);
    clearInterval(timer);
    timer = setInterval(tic, INTERVALO);
    document.addEventListener('visibilitychange', tic);
    carrega();
  }

  function registra() {
    const api_ = window.DGMesaAbas;
    if (api_ && typeof api_.registrar === 'function') {
      api_.registrar({ id: 'avisos', titulo: 'Avisos', montar, bolinha });
      espiar();
      espia = setInterval(() => { if (document.visibilityState === 'visible') espiar(); }, 60000);
      return;
    }
    const start = () => { const el = document.getElementById('avisosRaiz'); if (el) montar(el); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  return Object.assign({ montar, registra, bolinha }, puros);
});
