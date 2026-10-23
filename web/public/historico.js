/* historico.js: a gaveta "Histórico" da conversa (18/10/2026, ideia do dono).
   Duas abas: Conversas (busca nas conversas antigas e nas memórias, pelo índice local do agente)
   e Memórias (os arquivos de memória por grupo, só leitura). Tocar num trecho de conversa leva até
   a mensagem, se ela ainda estiver na conversa (window.DGConversaIr, de conversa.js).
   22/10/2026: conversa arquivada com imagens, nome editável (lápis) e "Continuar esta conversa"
   (manda ao agente um resumo do que foi dito, window.DGConversaRetomar); gaveta em tela cheia.
   API: /api/v1/historico/<agente>[/busca|/memorias|/memoria]. */
(function () {
  'use strict';
  const ICO = {
    relogio: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
    lupa: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    nota: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    lapis: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
    abrir: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    fechar2: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>',
    retomar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    seta: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let agente = null, el = null, aba = 'conversas', filtroSo = '', ultimaBusca = '', pedido = 0, aberta = null;
  const CHAVE_CHEIA = 'dg.historico.cheia';
  const lembra = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { return null; } return null; };

  async function api(caminho) {
    const r = await fetch('/api/v1/historico/' + encodeURIComponent(agente.id) + caminho, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    let d = null; try { d = await r.json(); } catch (_) { /* abaixo */ }
    if (!r.ok || !d || !d.ok) throw new Error((d && d.erro) || ('erro ' + r.status));
    return d;
  }

  function diaHumano(dia) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(dia || '')) return dia || '';
    const [a, m, d] = dia.slice(0, 10).split('-').map(Number);
    const hoje = new Date(); const ontem = new Date(Date.now() - 864e5);
    const igual = (x) => x.getFullYear() === a && x.getMonth() + 1 === m && x.getDate() === d;
    if (igual(hoje)) return 'Hoje';
    if (igual(ontem)) return 'Ontem';
    return `${d} de ${MESES[m - 1]}${a !== hoje.getFullYear() ? ' de ' + a : ''}`;
  }
  const epDe = (ts) => { const t = Date.parse(String(ts || '').replace(/Z?$/, 'Z')); return isNaN(t) ? 0 : t; };
  const hhmm = (ep) => { const d = new Date(ep); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function haQuanto(ep) {
    const s = (Date.now() - ep) / 1000;
    if (s < 90) return 'agora há pouco';
    if (s < 3600) return `há ${Math.round(s / 60)} min`;
    if (s < 86400) return `há ${Math.round(s / 3600)} h`;
    const d = new Date(ep); return `em ${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  // «trecho» do índice -> <mark>
  // tira a etiqueta [ENTREGA]/[PEDIDO] do começo (no chat ela vira marca, aqui seria ruído)
  const realce = (t) => esc(String(t || '').replace(/^\s*\[(?:«?)(ENTREGA|PEDIDO)(?:»?)\]\s*/i, '')).replace(/«/g, '<mark>').replace(/»/g, '</mark>');

  function nomeArquivo(arq) {
    if (arq === 'working-memory.md') return 'Memória de trabalho';
    if (arq === 'MEMORY.md') return 'Memória principal';
    const nome = arq.split('/').pop().replace(/\.(md|json)$/, '');
    const copia = /^MEMORY[-_](\d{4})-(\d{2})-(\d{2})/i.exec(nome);
    if (copia) return `Cópia da memória principal (${copia[3]}/${copia[2]})`;
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(nome);
    if (m) { const d = diaHumano(m[1]); return d === 'Hoje' || d === 'Ontem' ? `${d} (${m[1].split('-').reverse().join('/')})` : d; }
    const t = nome.replace(/[-_]+/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* Markdown mínimo e seguro para ler memória: título, lista, negrito, código. */
  function mdSimples(txt) {
    const linhas = String(txt).replace(/\r/g, '').split('\n');
    const inl = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    let html = '', lista = false, bloco = false;
    for (const l of linhas) {
      if (/^```/.test(l)) { if (lista) { html += '</ul>'; lista = false; } html += bloco ? '</pre>' : '<pre>'; bloco = !bloco; continue; }
      if (bloco) { html += esc(l) + '\n'; continue; }
      if (/^\s*<!--.*-->\s*$/.test(l)) continue;
      const li = /^\s*[-*]\s+(.*)$/.exec(l);
      if (li) { if (!lista) { html += '<ul>'; lista = true; } html += `<li>${inl(li[1])}</li>`; continue; }
      if (lista) { html += '</ul>'; lista = false; }
      const h = /^(#{1,6})\s+(.*)$/.exec(l);
      if (h) { html += `<h${Math.min(h[1].length + 2, 6)}>${inl(h[2])}</h${Math.min(h[1].length + 2, 6)}>`; continue; }
      if (/^>\s?/.test(l)) { html += `<blockquote>${inl(l.replace(/^>\s?/, ''))}</blockquote>`; continue; }
      if (l.trim()) html += `<p>${inl(l)}</p>`;
    }
    if (lista) html += '</ul>';
    if (bloco) html += '</pre>';
    return html;
  }

  function monta() {
    el = document.createElement('section');
    el.id = 'historicoPainel';
    el.className = 'hist';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Histórico');
    el.hidden = true;
    el.innerHTML =
      '<div class="hist-fundo" data-hist-fecha></div>' +
      '<div class="hist-caixa">' +
        '<header class="hist-cab"><div><h2>Histórico</h2><p class="hist-sub" id="histSub">Conferindo o que está guardado…</p></div>' +
        `<button type="button" class="hist-x hist-cheia" data-hist-cheia aria-label="Abrir em tela cheia" title="Tela cheia">${ICO.abrir}</button>` +
        `<button type="button" class="hist-x" data-hist-fecha aria-label="Fechar o histórico">${ICO.fechar}</button></header>` +
        '<nav class="hist-abas" role="tablist">' +
          '<button type="button" role="tab" data-hist-aba="conversas" aria-selected="true">Conversas</button>' +
          '<button type="button" role="tab" data-hist-aba="memorias" aria-selected="false">Memórias</button>' +
        '</nav>' +
        '<div class="hist-corpo" data-corpo="conversas">' +
          `<form class="hist-busca" role="search">${ICO.lupa}<input type="search" id="histQ" placeholder="Buscar nas conversas e memórias" autocomplete="off" enterkeyhint="search" aria-label="Buscar no histórico"></form>` +
          '<div class="hist-so" role="radiogroup" aria-label="Onde buscar">' +
            '<button type="button" data-so="" aria-checked="true" role="radio">Tudo</button>' +
            '<button type="button" data-so="conversas" aria-checked="false" role="radio">Só conversas</button>' +
            '<button type="button" data-so="memoria" aria-checked="false" role="radio">Só memórias</button>' +
          '</div>' +
          '<div class="hist-lista" id="histResultados" aria-live="polite"></div>' +
        '</div>' +
        '<div class="hist-corpo" data-corpo="memorias" hidden><div class="hist-lista" id="histMemorias"></div></div>' +
        '<div class="hist-corpo hist-leitor" data-corpo="leitor" hidden></div>' +
      '</div>';
    document.body.appendChild(el);
    telaCheia(lembra(CHAVE_CHEIA) === '1');

    el.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-hist-fecha]')) return fecha();
      if (ev.target.closest('[data-hist-cheia]')) { telaCheia(!el.classList.contains('cheia')); lembra(CHAVE_CHEIA, el.classList.contains('cheia') ? '1' : '0'); return; }
      if (ev.target.closest('[data-hist-renomear]')) return renomear();
      const ret = ev.target.closest('[data-hist-retomar]'); if (ret) return retomar(ret);
      const a = ev.target.closest('[data-hist-aba]'); if (a) return mostraAba(a.dataset.histAba);
      const so = ev.target.closest('[data-so]');
      if (so) {
        filtroSo = so.dataset.so;
        for (const b of el.querySelectorAll('[data-so]')) b.setAttribute('aria-checked', String(b === so));
        if (ultimaBusca) busca(ultimaBusca);
        return;
      }
      const arq = ev.target.closest('[data-arquivo]'); if (arq) return abreArquivo(arq.dataset.arquivo, arq.dataset.trecho || '');
      const av = ev.target.closest('[data-arquivada]'); if (av) return abreArquivada(av.dataset.arquivada);
      const nova = ev.target.closest('[data-hist-nova]'); if (nova) return novaConversa(nova);
      const vai = ev.target.closest('[data-ir]'); if (vai) return irPara(vai);
      if (ev.target.closest('[data-hist-volta]')) { mostraAba(aba); if (agente && agente.soArquivadas) el.querySelector('.hist-abas').hidden = true; return; }
      const sug = ev.target.closest('[data-sugestao]');
      if (sug) { const q = el.querySelector('#histQ'); q.value = sug.dataset.sugestao; busca(q.value); }
    });
    const form = el.querySelector('.hist-busca');
    const q = el.querySelector('#histQ');
    let espera = 0;
    form.addEventListener('submit', (ev) => { ev.preventDefault(); clearTimeout(espera); busca(q.value); q.blur(); });
    q.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => busca(q.value), 450); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && el && !el.hidden) fecha(); });
  }

  function telaCheia(sim) {
    el.classList.toggle('cheia', sim);
    const b = el.querySelector('[data-hist-cheia]');
    b.innerHTML = sim ? ICO.fechar2 : ICO.abrir;
    b.setAttribute('aria-label', sim ? 'Voltar para a gaveta' : 'Abrir em tela cheia');
    b.title = sim ? 'Sair da tela cheia' : 'Tela cheia';
  }

  function mostraAba(qual) {
    aba = qual;
    for (const b of el.querySelectorAll('[data-hist-aba]')) b.setAttribute('aria-selected', String(b.dataset.histAba === qual));
    for (const c of el.querySelectorAll('[data-corpo]')) c.hidden = c.dataset.corpo !== qual;
    el.querySelector('.hist-abas').hidden = false;
    if (qual === 'memorias') carregaMemorias();
    if (qual === 'conversas' && !ultimaBusca) inicioConversas();
  }

  /* Sem busca, a aba Conversas mostra as arquivadas: o que cada /clear (ou "Nova conversa") tirou da tela. */
  async function inicioConversas() {
    const lista = el.querySelector('#histResultados');
    const meu = ++pedido;
    const cab = '<div class="hist-arq-cab"><h3 class="hist-dia">Conversas arquivadas</h3>' +
      '<button type="button" class="hist-nova" data-hist-nova>Nova conversa</button></div>';
    lista.innerHTML = cab + '<p class="hist-carregando">Carregando…</p>';
    let arq = [];
    try { arq = (await api('/arquivadas')).arquivadas || []; } catch (e) {
      if (meu === pedido) lista.innerHTML = cab + `<p class="hist-erro">Não consegui trazer as conversas arquivadas: ${esc(e.message)}</p>`;
      return;
    }
    if (meu !== pedido) return;
    if (!arq.length && agente.soArquivadas) {
      lista.innerHTML = cab + '<div class="hist-vazio"><p>Nenhuma conversa arquivada ainda.</p></div>';
      return;
    }
    if (!arq.length) {
      lista.innerHTML = cab + `<div class="hist-vazio">${ICO.relogio.replace('width="16" height="16"', 'width="28" height="28"')}` +
        '<p>Nenhuma conversa arquivada ainda.</p>' +
        '<p class="hist-dica">Toque em <b>Nova conversa</b> (ou mande /clear no chat): a conversa de agora vem para cá e a tela recomeça limpa. ' +
        `Para achar algo, digite uma palavra na busca acima.</p></div>`;
      return;
    }
    let html = cab + '<ul class="hist-itens">';
    for (const a of arq) {
      html += `<li><button type="button" class="hist-item arquivada${a.nomeado ? ' nomeada' : ''}" data-arquivada="${esc(a.id)}">` +
        `<span class="hist-arq-titulo">${esc(a.titulo)}</span>` +
        `<span class="hist-quem">${esc(periodo(a.de, a.ate))} · ${a.total === 1 ? '1 mensagem' : a.total + ' mensagens'}</span>` +
        (a.previa ? `<span class="hist-previa">${esc(a.previa)}</span>` : '') + '</button></li>';
    }
    lista.innerHTML = html + '</ul>';
  }

  // "18 de outubro, 07:13 a 10:58" (ep em segundos)
  function periodo(de, ate) {
    const d1 = new Date(de * 1000), d2 = new Date(ate * 1000);
    const dia = (d) => diaHumano(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    const h = (d) => hhmm(d.getTime());
    return dia(d1) === dia(d2) ? `${dia(d1)}, ${h(d1)} a ${h(d2)}` : `${dia(d1)} ${h(d1)} a ${dia(d2).toLowerCase()} ${h(d2)}`;
  }

  async function abreArquivada(id) {
    const leitor = el.querySelector('[data-corpo="leitor"]');
    for (const c of el.querySelectorAll('[data-corpo]')) c.hidden = c !== leitor;
    el.querySelector('.hist-abas').hidden = true;
    aberta = null;
    leitor.innerHTML = `<header class="hist-leitor-cab"><button type="button" class="hist-volta" data-hist-volta aria-label="Voltar">${ICO.voltar}</button>` +
      '<div class="hist-leitor-tit"><b>Conversa arquivada</b><small>Carregando…</small></div>' +
      `<button type="button" class="hist-x hist-lapis" data-hist-renomear aria-label="Dar outro nome" title="Dar outro nome" hidden>${ICO.lapis}</button></header>` +
      '<div class="hist-texto hist-conversa"></div>';
    try {
      const d = await api('/arquivadas/' + encodeURIComponent(id));
      aberta = d;
      leitor.querySelector('b').textContent = d.arquivada.titulo;
      leitor.querySelector('small').textContent = `${periodo(d.arquivada.de, d.arquivada.ate)} · ${d.arquivada.total} mensagens`;
      leitor.querySelector('[data-hist-renomear]').hidden = false;
      let html = '', dia = '';
      for (const m of d.msgs) {
        const dt = new Date(m.ep * 1000);
        const dd = diaHumano(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`);
        if (dd !== dia) { dia = dd; html += `<p class="hist-conv-dia">${esc(dd)}</p>`; }
        if (m.origin === 'trilha') { html += `<p class="hist-conv-passo">${esc(String(m.text || '').replace(/^rodou:\s*/, ''))}</p>`; continue; }
        const dono = m.origin === 'dono';
        const texto = String(m.text || '').replace(/^\s*\[(ENTREGA|PEDIDO)\]\s*/i, '');
        const corpo = texto.replace(/```dgui[\s\S]*?```/g, '').trim();
        const visuais = /```dgui/.test(texto);
        html += `<div class="hist-conv-msg ${dono ? 'dono' : 'agente'}"><div class="hist-conv-balao">${midia(m.media)}${(corpo || visuais) && !(m.media && corpo === m.media.nome) ? comVisuais(texto) : ''}</div>` +
          `<span class="hist-conv-hora">${dono ? 'Você' : esc(agente.nome)} · ${hhmm(m.ep * 1000)}</span></div>`;
      }
      leitor.querySelector('.hist-texto').innerHTML = (html || '<p class="hist-dica">Sem mensagens de texto nesta conversa.</p>') +
        (typeof window.DGConversaRetomar === 'function'
          ? `<div class="hist-retomar"><button type="button" class="hist-nova" data-hist-retomar>${ICO.retomar}Continuar esta conversa</button>` +
            `<p class="hist-dica">${esc(agente.nome)} recebe um resumo do que foi dito aqui e segue dali. Gasta um pouco do limite.</p></div>`
          : '');
    } catch (e) { leitor.querySelector('small').textContent = 'Não consegui abrir: ' + e.message; }
  }

  // texto com os blocos ```dgui desenhados como na conversa (passos, tabela, gráfico); a escolha vira
  // lista parada, porque tocar numa opção aqui mandaria resposta a uma pergunta já encerrada
  function comVisuais(txt) {
    let html = '';
    for (const p of String(txt).split(/(```dgui[ \t]*\r?\n[\s\S]*?```)/)) {
      const b = /^```(dgui[ \t]*\r?\n[\s\S]*?)```$/.exec(p);
      if (!b) { if (p.trim()) html += mdSimples(p.trim()); continue; }
      let d = null;
      try { d = JSON.parse(b[1].replace(/^dgui[ \t]*\r?\n/, '')); } catch (_) { /* inválido: o dgui.js mostra o aviso */ }
      if (d && d.tipo === 'escolha') {
        const ops = (Array.isArray(d.opcoes) ? d.opcoes : []).map((o) => (o && typeof o === 'object' ? o.texto : o)).filter(Boolean);
        html += (d.pergunta ? `<p><b>${esc(d.pergunta)}</b></p>` : '') + (ops.length ? `<ul>${ops.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : '');
        continue;
      }
      html += (window.dgui && window.dgui.blocoParaHtml(b[1])) || '';
    }
    return html;
  }

  // foto ou vídeo guardado: a miniatura, que abre o original; o resto, ícone com o nome
  function midia(md) {
    if (!md) return '';
    if (md.disponivel && md.url && (md.kind === 'photo' || md.kind === 'image' || md.kind === 'video') && (md.thumb || md.kind !== 'video')) {
      return `<a class="hist-conv-foto" href="${esc(md.url)}" target="_blank" rel="noopener" aria-label="Abrir ${esc(md.nome || 'a imagem')}">` +
        `<img loading="lazy" alt="" src="${esc(md.thumb || md.url)}"></a>`;
    }
    const nome = `${ICO.nota}${esc(md.nome || 'arquivo')}`;
    return md.disponivel && md.url
      ? `<a class="hist-conv-anexo" href="${esc(md.url)}" target="_blank" rel="noopener">${nome}</a>`
      : `<span class="hist-conv-anexo">${nome}</span>`;
  }

  // o lápis troca o título por um campo; Enter ou sair do campo grava, Esc desiste, vazio volta ao automático
  function renomear() {
    if (!aberta) return;
    const tit = el.querySelector('.hist-leitor-tit');
    const b = tit.querySelector('b');
    if (!b || tit.querySelector('input')) return;
    const campo = document.createElement('input');
    campo.type = 'text'; campo.maxLength = 80; campo.className = 'hist-renomeia';
    campo.value = aberta.arquivada.nomeado ? aberta.arquivada.titulo : '';
    campo.placeholder = aberta.arquivada.titulo;
    campo.setAttribute('aria-label', 'Nome da conversa');
    b.replaceWith(campo);
    campo.focus(); campo.select();
    let feito = false;
    const termina = async (grava) => {
      if (feito) return; feito = true;
      const volta = document.createElement('b');
      volta.textContent = aberta.arquivada.titulo;
      campo.replaceWith(volta);
      const novo = campo.value.trim();
      if (!grava || novo === (aberta.arquivada.nomeado ? aberta.arquivada.titulo : '')) return;
      volta.textContent = novo || 'Salvando…';
      try {
        const r = await fetch('/api/v1/historico/' + encodeURIComponent(agente.id) + '/arquivadas/' + encodeURIComponent(aberta.arquivada.id), {
          method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ titulo: novo }) });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !d.ok) throw new Error((d && d.erro) || ('erro ' + r.status));
        aberta.arquivada = d.arquivada;
        volta.textContent = d.arquivada.titulo;
      } catch (e) {
        volta.textContent = aberta.arquivada.titulo;
        tit.querySelector('small').textContent = 'Não consegui salvar o nome: ' + e.message;
      }
    };
    campo.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); termina(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); termina(false); }
    });
    campo.addEventListener('blur', () => termina(true));
  }

  /* Resumo para o agente retomar: o que o dono pediu e o que ele respondeu, sem os passos, cada fala
     encurtada; se passar do teto, ficam a primeira fala e o fim (o meio vira "…"). Não chama IA nenhuma. */
  const TETO_FALA = 300, TETO_RESUMO = 3500;
  function resumoParaRetomar(d) {
    const falas = d.msgs.filter((m) => m.origin !== 'trilha').map((m) => {
      let t = String(m.text || '').replace(/```[\s\S]*?```/g, ' ').replace(/^\s*\[(ENTREGA|PEDIDO)\]\s*/i, '').replace(/\s+/g, ' ').trim();
      if (!t && m.media) t = `[${m.media.nome || 'arquivo'}]`;
      if (!t || /^\/[a-z][\w-]*$/i.test(t)) return '';
      if (t.length > TETO_FALA) t = t.slice(0, TETO_FALA - 1).trimEnd() + '…';
      return `${m.origin === 'dono' ? 'Dono' : agente.nome}: ${t}`;
    }).filter(Boolean);
    if (!falas.length) return '';
    // o começo (o pedido) sempre vai; do fim (onde parou) para trás, até o teto
    const fim = [];
    let total = falas[0].length;
    for (let k = falas.length - 1; k > 0; k--) {
      if (total + falas[k].length > TETO_RESUMO) break;
      total += falas[k].length + 1;
      fim.unshift(falas[k]);
    }
    return [falas[0]].concat(fim.length < falas.length - 1 ? ['…'] : [], fim).join('\n');
  }

  async function retomar(botao) {
    if (!aberta || typeof window.DGConversaRetomar !== 'function') return;
    if (botao.dataset.confirma !== '1') {
      botao.dataset.confirma = '1';
      botao.lastChild.textContent = 'Toque de novo para continuar';
      setTimeout(() => { if (botao.isConnected) { botao.dataset.confirma = ''; botao.lastChild.textContent = 'Continuar esta conversa'; } }, 4000);
      return;
    }
    const a = aberta.arquivada;
    const texto = `Vamos continuar a conversa arquivada "${a.titulo}" (${periodo(a.de, a.ate)}). ` +
      'Você não lembra dela, então aqui vai o que foi dito. Leia e me diga em uma frase onde paramos e o que falta.\n\n' +
      resumoParaRetomar(aberta);
    botao.disabled = true;
    fecha();
    await window.DGConversaRetomar(texto);
  }

  async function novaConversa(botao) {
    if (botao.dataset.confirma !== '1') {
      botao.dataset.confirma = '1';
      botao.textContent = 'Toque de novo para confirmar';
      setTimeout(() => { if (botao.isConnected) { botao.dataset.confirma = ''; botao.textContent = 'Nova conversa'; } }, 4000);
      return;
    }
    if (typeof window.DGConversaNova !== 'function') return;
    botao.disabled = true; botao.textContent = 'Arquivando…';
    fecha();
    await window.DGConversaNova();
  }

  async function abre(ag) {
    if (!el) monta();
    if (!agente || agente.id !== ag.id) { agente = ag; ultimaBusca = ''; el.querySelector('#histQ').value = ''; el.dataset.memorias = ''; }
    el.hidden = false;
    document.documentElement.classList.add('hist-aberto');
    // Admin (soArquivadas): sem busca nem memórias, só a lista do que o /clear arquivou
    el.classList.toggle('so-arquivadas', !!ag.soArquivadas);
    el.querySelector('.hist-busca').hidden = el.querySelector('.hist-so').hidden = !!ag.soArquivadas;
    mostraAba('conversas');
    if (ag.soArquivadas) {
      el.querySelector('.hist-abas').hidden = true;
      el.querySelector('#histSub').textContent = 'As conversas que você arquivou com Nova conversa ou /clear.';
      return;
    }
    setTimeout(() => { if (matchMedia('(pointer:fine)').matches) el.querySelector('#histQ').focus(); }, 60);
    const sub = el.querySelector('#histSub');
    try {
      const s = await api('');
      if (!s.ligada) { sub.textContent = 'A busca ainda não tem nada guardado. Ela começa a valer depois da próxima rotina dele.'; return; }
      const de = s.primeira_conversa ? diaHumano(s.primeira_conversa).toLowerCase() : '';
      sub.textContent = `${s.conversa} falas e ${s.memoria} trechos de memória` + (de ? `, desde ${de.startsWith('hoje') || de.startsWith('ontem') ? de : 'o dia ' + de}` : '');
    } catch (e) { sub.textContent = 'Não consegui ler o histórico: ' + e.message; }
  }
  function fecha() {
    if (!el) return;
    el.hidden = true;
    document.documentElement.classList.remove('hist-aberto');
  }

  async function busca(texto) {
    const q = String(texto || '').trim();
    const lista = el.querySelector('#histResultados');
    ultimaBusca = q;
    if (q.replace(/[^\p{L}\p{N}]/gu, '').length < 2) { ultimaBusca = ''; inicioConversas(); return; }
    const meu = ++pedido;
    lista.innerHTML = '<p class="hist-carregando">Buscando…</p>';
    try {
      const d = await api('/busca?q=' + encodeURIComponent(q) + (filtroSo ? '&so=' + filtroSo : ''));
      if (meu !== pedido) return;
      lista.innerHTML = desenhaResultados(d, q);
    } catch (e) {
      if (meu === pedido) lista.innerHTML = `<p class="hist-erro">Não consegui buscar agora: ${esc(e.message)}</p>`;
    }
  }

  function desenhaResultados(d, q) {
    const rs = d.resultados || [];
    if (!rs.length) return `<div class="hist-vazio">${ICO.lupa}<p>Nada encontrado para <b>${esc(q)}</b>.</p><p class="hist-dica">Tente outra palavra, ou uma parte dela.</p></div>`;
    // por dia, mais recente primeiro; dentro do dia, na ordem da relevância
    const dias = new Map();
    for (const r of rs) { const k = r.dia || ''; if (!dias.has(k)) dias.set(k, []); dias.get(k).push(r); }
    const ordem = Array.from(dias.keys()).sort().reverse();
    // dentro do dia, do mais recente para o mais antigo (a busca já escolheu os melhores)
    for (const l of dias.values()) l.sort((x, y) => String(y.ts || '').localeCompare(String(x.ts || '')));
    let html = d.aviso ? `<p class="hist-aviso">Nenhum trecho tem todas as palavras; estes têm alguma delas.</p>` : '';
    html += `<p class="hist-conta">${rs.length === 1 ? '1 resultado' : rs.length + ' resultados'}</p>`;
    for (const dia of ordem) {
      html += `<h3 class="hist-dia">${esc(diaHumano(dia))}</h3><ul class="hist-itens">`;
      for (const r of dias.get(dia)) html += itemResultado(r);
      html += '</ul>';
    }
    return html;
  }

  function itemResultado(r) {
    if (r.tipo === 'memoria') {
      const arq = String(r.ref || '').split(':')[0];
      const secao = String(r.ref || '').split(' · ').slice(1).join(' · ');
      return `<li><button type="button" class="hist-item mem" data-arquivo="${esc(arq)}" data-trecho="${esc(r.trecho.replace(/[«»]/g, ''))}">` +
        `<span class="hist-quem"><span class="hist-ico">${ICO.nota}</span>Memória · ${esc(nomeArquivo(arq))}${secao ? ` <span class="hist-secao">${esc(secao)}</span>` : ''}</span>` +
        `<span class="hist-trecho">${realce(r.trecho)}</span><span class="hist-ir">Abrir a anotação ${ICO.seta}</span></button></li>`;
    }
    const ep = epDe(r.ts);
    const quem = r.papel === 'dono' ? 'Você' : (r.papel === 'agente-rotina' ? `${agente.nome}, por conta própria` : agente.nome);
    return `<li><button type="button" class="hist-item ${r.papel === 'dono' ? 'dono' : 'agente'}" data-ir="${ep}" data-papel="${esc(r.papel)}">` +
      `<span class="hist-quem"><b>${esc(quem)}</b><span class="hist-hora">${ep ? hhmm(ep) : ''}</span></span>` +
      `<span class="hist-trecho">${realce(r.trecho)}</span><span class="hist-ir">Ver na conversa ${ICO.seta}</span></button></li>`;
  }

  async function irPara(botao) {
    const ep = Number(botao.dataset.ir);
    const ir = window.DGConversaIr;
    if (!ep || typeof ir !== 'function') return;
    botao.classList.add('indo');
    let achou = false;
    try { achou = await ir(ep, botao.dataset.papel === 'dono'); } catch (_) { achou = false; }
    botao.classList.remove('indo');
    if (achou) { fecha(); return; }
    const ja = botao.querySelector('.hist-ir');
    if (ja) ja.textContent = 'Essa mensagem já não está na conversa; o trecho acima é o que ficou guardado.';
  }

  async function carregaMemorias() {
    const lista = el.querySelector('#histMemorias');
    if (el.dataset.memorias === agente.id) return;
    lista.innerHTML = '<p class="hist-carregando">Carregando as memórias…</p>';
    try {
      const d = await api('/memorias');
      el.dataset.memorias = agente.id;
      if (!d.arquivos.length) { lista.innerHTML = `<div class="hist-vazio">${ICO.nota}<p>${esc(agente.nome)} ainda não anotou nada.</p></div>`; return; }
      let html = '<p class="hist-dica topo">O que ele guarda para lembrar entre uma conversa e outra. Só leitura: para mudar, peça a ele na conversa.</p>';
      for (const g of d.grupos) {
        const itens = d.arquivos.filter((a) => a.grupo === g);
        if (!itens.length) continue;
        html += `<h3 class="hist-dia">${esc(g)}</h3><ul class="hist-itens">`;
        for (const a of itens) {
          html += `<li><button type="button" class="hist-item arq" data-arquivo="${esc(a.arquivo)}"><span class="hist-ico">${ICO.nota}</span>` +
            `<span class="hist-arq-txt"><b>${esc(nomeArquivo(a.arquivo))}</b><small>atualizada ${esc(haQuanto(a.mudou))}</small></span>${ICO.seta}</button></li>`;
        }
        html += '</ul>';
      }
      lista.innerHTML = html;
    } catch (e) { lista.innerHTML = `<p class="hist-erro">Não consegui trazer as memórias: ${esc(e.message)}</p>`; }
  }

  async function abreArquivo(arquivo, trecho) {
    const leitor = el.querySelector('[data-corpo="leitor"]');
    for (const c of el.querySelectorAll('[data-corpo]')) c.hidden = c !== leitor;
    el.querySelector('.hist-abas').hidden = true;
    leitor.innerHTML = `<header class="hist-leitor-cab"><button type="button" class="hist-volta" data-hist-volta aria-label="Voltar">${ICO.voltar}</button>` +
      `<div><b>${esc(nomeArquivo(arquivo))}</b><small>Carregando…</small></div></header><div class="hist-texto"></div>`;
    try {
      const d = await api('/memoria?arquivo=' + encodeURIComponent(arquivo));
      leitor.querySelector('small').textContent = `${d.grupo} · atualizada ${haQuanto(d.mudou)}` + (d.cortado ? ' · mostrando o começo' : '');
      const alvo = leitor.querySelector('.hist-texto');
      if (/\.json$/.test(arquivo)) {
        let t = d.texto; try { t = JSON.stringify(JSON.parse(d.texto), null, 2); } catch (_) { /* fica cru */ }
        alvo.innerHTML = `<pre>${esc(t)}</pre>`;
      } else alvo.innerHTML = mdSimples(d.texto);
      if (trecho) marcaTrecho(alvo, trecho);
    } catch (e) { leitor.querySelector('small').textContent = 'Não consegui abrir: ' + e.message; }
  }

  // leva o leitor até o parágrafo que a busca achou
  function marcaTrecho(alvo, trecho) {
    const chave = trecho.replace(/\s*…\s*/g, ' ').trim().slice(0, 40).toLowerCase();
    if (chave.length < 6) return;
    const bloco = Array.from(alvo.querySelectorAll('p,li,h3,h4,h5,h6,blockquote')).find((b) => b.textContent.toLowerCase().includes(chave.slice(0, 24)));
    if (!bloco) return;
    bloco.classList.add('hist-achado');
    setTimeout(() => bloco.scrollIntoView({ block: 'center' }), 30);
  }

  window.DGHistorico = { abre, fecha, ICONE: ICO.relogio };
})();
