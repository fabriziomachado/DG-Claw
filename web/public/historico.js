/* historico.js: a gaveta "Histórico" da conversa (18/10/2026, ideia do dono).
   Duas abas: Conversas (busca nas conversas antigas e nas memórias, pelo índice local do agente)
   e Memórias (os arquivos de memória por grupo, só leitura). Tocar num trecho de conversa leva até
   a mensagem, se ela ainda estiver na conversa (window.DGConversaIr, de conversa.js).
   API: /api/v1/historico/<agente>[/busca|/memorias|/memoria]. */
(function () {
  'use strict';
  const ICO = {
    relogio: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
    lupa: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    nota: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    seta: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let agente = null, el = null, aba = 'conversas', filtroSo = '', ultimaBusca = '', pedido = 0;

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
        `<button type="button" class="hist-x" data-hist-fecha aria-label="Fechar o histórico">${ICO.fechar}</button></header>` +
        '<nav class="hist-abas" role="tablist">' +
          '<button type="button" role="tab" data-hist-aba="conversas" aria-selected="true">Conversas</button>' +
          '<button type="button" role="tab" data-hist-aba="memorias" aria-selected="false">Memórias</button>' +
        '</nav>' +
        '<div class="hist-corpo" data-corpo="conversas">' +
          `<form class="hist-busca" role="search">${ICO.lupa}<input type="search" id="histQ" placeholder="Buscar por assunto, nome ou número" autocomplete="off" enterkeyhint="search" aria-label="Buscar no histórico"></form>` +
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

    el.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-hist-fecha]')) return fecha();
      const a = ev.target.closest('[data-hist-aba]'); if (a) return mostraAba(a.dataset.histAba);
      const so = ev.target.closest('[data-so]');
      if (so) {
        filtroSo = so.dataset.so;
        for (const b of el.querySelectorAll('[data-so]')) b.setAttribute('aria-checked', String(b === so));
        if (ultimaBusca) busca(ultimaBusca);
        return;
      }
      const arq = ev.target.closest('[data-arquivo]'); if (arq) return abreArquivo(arq.dataset.arquivo, arq.dataset.trecho || '');
      const vai = ev.target.closest('[data-ir]'); if (vai) return irPara(vai);
      if (ev.target.closest('[data-hist-volta]')) return mostraAba(aba);
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

  function mostraAba(qual) {
    aba = qual;
    for (const b of el.querySelectorAll('[data-hist-aba]')) b.setAttribute('aria-selected', String(b.dataset.histAba === qual));
    for (const c of el.querySelectorAll('[data-corpo]')) c.hidden = c.dataset.corpo !== qual;
    el.querySelector('.hist-abas').hidden = false;
    if (qual === 'memorias') carregaMemorias();
    if (qual === 'conversas' && !ultimaBusca) inicioConversas();
  }

  function inicioConversas() {
    el.querySelector('#histResultados').innerHTML =
      `<div class="hist-vazio">${ICO.lupa}<p>Digite uma palavra para achar o que vocês já conversaram e o que ${esc(agente.nome)} anotou.</p>` +
      '<p class="hist-dica">Ele também acha sozinho quando você pergunta "lembra quando…" na conversa.</p></div>';
  }

  async function abre(ag) {
    if (!el) monta();
    if (!agente || agente.id !== ag.id) { agente = ag; ultimaBusca = ''; el.querySelector('#histQ').value = ''; el.dataset.memorias = ''; }
    el.hidden = false;
    document.documentElement.classList.add('hist-aberto');
    mostraAba('conversas');
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
