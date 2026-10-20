'use strict';
/* board-hoje.js: a aba Hoje do Board (19/10/2026, pedido do dono). A central do dia, na primeira aba:
   - criar com uma frase: "me lembra amanhã às 9h de ligar pro contador" vira lembrete (o S2 Bot entende
     a data e a hora aqui, sem formulário) ou tarefa para o agente escolhido;
   - "Seus lembretes de hoje": os que tocam hoje e os que estão tocando agora (Feito ali mesmo);
   - "Esperando você": tarefas do Board esperando você e, se houver, o atalho para a Caixa de entrada;
   - "Agentes fazendo" (com andamento) e "Pronto hoje".
   Dados: GET /api/v1/tarefas, /api/v1/lembretes, /api/v1/caixa e /api/v1/agents. A parte que entende a
   frase (entendeFrase) é pura e tem teste em web/test/board-hoje.test.js. */
(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.DGBoardHoje = m;
})(this, function (raiz) {
  const pad2 = n => String(n).padStart(2, '0');
  const DIAS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
  const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

  /* "me lembra amanhã às 9h de ligar pro contador" -> { texto, regra } ou { texto, daqui_min }.
     Sem data nem hora reconhecível devolve null (a tela pede um exemplo). agora: Date. */
  function entendeFrase(frase, agora) {
    let t = ' ' + String(frase || '').trim() + ' ';
    const base = semAcento(t.toLowerCase());
    const tira = (rx) => { t = t.replace(rx, ' '); };
    // "daqui a 30 min", "em 2 horas"
    let m = /\s(?:daqui a|daqui|em)\s+(\d{1,4})\s*(min|minutos?|h|horas?)\b/.exec(base);
    if (m) {
      const n = +m[1] * (/^h/.test(m[2]) ? 60 : 1);
      tira(new RegExp('\\s(?:daqui a|daqui|em)\\s+' + m[1] + '\\s*' + m[2] + '\\b', 'i'));
      return n >= 1 && n <= 10080 ? { texto: limpa(t), daqui_min: n } : null;
    }
    let dia = null, hora = null, min = 0, semana = false;
    const d0 = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const fim = '(?=[\\s,.;:!?]|$)';   // \b não serve depois de letra acentuada (ã, á)
    if (/\sdepois de amanha(?=[\s,.;:!?])/.test(base)) { dia = new Date(d0); dia.setDate(dia.getDate() + 2); tira(new RegExp('\\sdepois de amanh[ãa]' + fim, 'i')); }
    else if (/\samanha(?=[\s,.;:!?])/.test(base)) { dia = new Date(d0); dia.setDate(dia.getDate() + 1); tira(new RegExp('\\samanh[ãa]' + fim, 'i')); }
    else if (/\shoje(?=[\s,.;:!?])/.test(base)) { dia = new Date(d0); tira(new RegExp('\\shoje' + fim, 'i')); }
    else if ((m = /\sdia\s+(\d{1,2})(?:\/(\d{1,2}))?(?=[\s,.;:!?])/.exec(base))) {
      const mes = m[2] ? +m[2] - 1 : d0.getMonth();
      dia = new Date(d0.getFullYear(), mes, +m[1]);
      if (dia < d0) { if (m[2]) dia.setFullYear(dia.getFullYear() + 1); else dia = new Date(d0.getFullYear(), mes + 1, +m[1]); }
      tira(new RegExp('\\sdia\\s+' + m[1] + (m[2] ? '\\/' + m[2] : '') + fim, 'i'));
    } else if ((m = /\s(?:na |no |nesta |neste |proxima |proximo )?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?(?=[\s,.;:!?])/.exec(base))) {
      const alvo = DIAS[m[1]];
      dia = new Date(d0); dia.setDate(dia.getDate() + ((alvo - d0.getDay() + 7) % 7)); semana = true;
      tira(new RegExp('\\s(?:na |no |nesta |neste |pr[óo]xima |pr[óo]ximo )?(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)(?:-feira)?' + fim, 'i'));
    }
    // a hora é procurada no que sobrou (sem o "dia 25"): "às 9h", "as 9:30", "9h30", "às 15", "8 da noite"
    const resto = semAcento(t.toLowerCase());
    m = /\s(?:as\s+|a\s+)(\d{1,2})(?:[h:](\d{2})?)?(?:\s+(?:horas?\s+)?(da manha|da tarde|da noite))?(?=[\s,.;:!?])/.exec(resto)
      || /\s(\d{1,2})(?:h(\d{2})?|:(\d{2}))(?:\s+(?:horas?\s+)?(da manha|da tarde|da noite))?(?=[\s,.;:!?])/.exec(resto)
      || /\s(\d{1,2})()\s+(?:horas?\s+)?(da manha|da tarde|da noite)(?=[\s,.;:!?])/.exec(resto);
    if (m) {
      const periodo = m[4] || m[3] && /da /.test(m[3]) && m[3] || '';
      hora = +m[1]; min = m[2] ? +m[2] : (m[3] && /^\d+$/.test(m[3]) ? +m[3] : 0);
      if (/tarde|noite/.test(periodo) && hora < 12) hora += 12;
      if (hora > 23 || min > 59) return null;
      t = t.replace(new RegExp('\\s(?:[àa]s\\s+|a\\s+)?' + m[1] + '(?:[h:]\\d{0,2})?(?:\\s+(?:horas?\\s+)?(?:da manh[ãa]|da tarde|da noite))?' + fim, 'i'), ' ');
    }
    if (hora === null && !dia) return null;
    if (hora === null) { hora = 9; min = 0; }
    const passou = hora * 60 + min <= agora.getHours() * 60 + agora.getMinutes();
    if (!dia) { dia = new Date(d0); if (passou) dia.setDate(dia.getDate() + 1); }
    else if (dia.getTime() === d0.getTime() && passou) {
      if (!semana) return null;   // "hoje às 8h" quando já passou: a tela pede outra hora
      dia.setDate(dia.getDate() + 7);
    }
    const data = `${dia.getFullYear()}-${pad2(dia.getMonth() + 1)}-${pad2(dia.getDate())}`;
    return { texto: limpa(t), regra: { tipo: 'unico', data, hora: `${pad2(hora)}:${pad2(min)}` } };
  }
  function limpa(t) {
    let s = t.replace(/\s+/g, ' ').trim()
      .replace(/^(?:me\s+)?lembr(?:a|e|ar)(?:-me)?\s*(?:de\s+|que\s+|pra\s+|para\s+)?/i, '')
      .replace(/^(?:de|que|pra|para)\s+/i, '')
      .replace(/\s+(?:de|que|pra|para)$/i, '')
      .replace(/^[,.:;\-\s]+|[,.:;\-\s]+$/g, '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }
  /* "amanhã (20/10) às 09:00" para mostrar o que foi entendido */
  function descreve(r, agora) {
    if (!r) return '';
    if (r.daqui_min) return r.daqui_min < 60 ? `daqui a ${r.daqui_min} min` : `daqui a ${Math.round(r.daqui_min / 6) / 10} h`.replace('.', ',');
    const [a, mm, d] = r.regra.data.split('-').map(Number);
    const dia = new Date(a, mm - 1, d), d0 = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const dif = Math.round((dia - d0) / 86400000);
    const nome = dif === 0 ? 'hoje' : dif === 1 ? 'amanhã' : ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][dia.getDay()];
    return `${nome} (${pad2(d)}/${pad2(mm)}) às ${r.regra.hora}`;
  }

  if (!raiz.document) return { entendeFrase, descreve };

  /* ───────────── tela ───────────── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let el = null, agentes = [], timer = null;
  const ico = (d, t) => `<svg viewBox="0 0 24 24" width="${t || 16}" height="${t || 16}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICO = {
    sino: ico('<path d="M18 16v-5a6 6 0 0 0-12 0v5l-1.5 2h15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    tarefa: ico('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    caixa: ico('<path d="M4 13h4l1.5 2.5h5L16 13h4"/><path d="M5.5 5h13L20 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V13z"/>'),
    espera: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    fazendo: ico('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>'),
    pronto: ico('<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    relogio: ico('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 1.5"/>', 14),
    seta: ico('<path d="m9 6 6 6-6 6"/>', 14),
  };

  async function api(url, op) {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, op || {}));
    if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent('/mesa'); throw new Error('sessão expirada'); }
    let d = null; try { d = await r.json(); } catch (_) { d = null; }
    if (!r.ok || !d || d.ok === false) throw new Error((d && (d.erro || d.error)) || ('o servidor respondeu ' + r.status));
    return d;
  }
  const post = (url, corpo) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });

  function foto(slug) {
    const a = agentes.find(x => x.id === slug) || { nome: slug, cor: '#5b6472' };
    const img = a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '');
    return `<span class="bh-av" style="background:${esc(a.cor || '#5b6472')}" title="${esc(a.nome)}">${img ? `<img src="${esc(img)}" alt="">` : esc((a.avatar || a.nome || '?').slice(0, 1))}</span>`;
  }
  function agentePadrao() {
    const q = new URLSearchParams(location.search).get('a');
    let g = null; try { g = localStorage.getItem('dgclaw:agente'); } catch (_) { g = null; }
    const ok = id => id && agentes.some(a => a.id === id);
    return ok(q) ? q : ok(g) ? g : ((agentes.find(a => a.tipo !== 'admin') || agentes[0] || {}).id || '');
  }

  function montar(painel) {
    el = painel;
    el.innerHTML = `<div class="bh">
      <section class="bh-novo" data-tour="bh-novo">
        <textarea id="bhFrase" rows="2" maxlength="500" placeholder="Escreva: me lembra amanhã às 9h de ligar pro contador"></textarea>
        <p class="bh-entendi" id="bhEntendi" aria-live="polite"></p>
        <div class="bh-acoes"><button type="button" class="bh-bt pri" data-novo="lembrete">${ICO.sino}Lembrete</button>
          <button type="button" class="bh-bt" data-novo="tarefa">${ICO.tarefa}Tarefa para</button>
          <select id="bhAgente" aria-label="De qual agente"></select></div>
        <p class="bh-msg" id="bhMsg" role="status" hidden></p>
      </section>
      <div id="bhDia"><p class="bh-fraco">Carregando o seu dia…</p></div></div>`;
    const frase = el.querySelector('#bhFrase'), entendi = el.querySelector('#bhEntendi');
    frase.addEventListener('input', () => {
      const r = frase.value.trim() ? entendeFrase(frase.value, new Date()) : null;
      entendi.textContent = !frase.value.trim() ? '' : r ? `Lembrete para ${descreve(r, new Date())}: ${r.texto || '(sem texto)'}` : 'Para lembrete, diga quando: "amanhã às 9h", "daqui a 30 min", "sexta às 14h".';
    });
    el.addEventListener('click', aoClicar);
    carrega();
    if (!timer) {
      timer = setInterval(() => { if (!document.hidden && el && !el.closest('[hidden]')) carrega(); }, 30000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) carrega(); });
    }
  }

  function msg(t, erro) {
    const m = el.querySelector('#bhMsg');
    m.textContent = t; m.hidden = !t; m.classList.toggle('erro', !!erro);
  }

  async function aoClicar(ev) {
    const novo = ev.target.closest('[data-novo]');
    if (novo) return cria(novo.dataset.novo, novo);
    const feito = ev.target.closest('[data-feito]');
    if (feito) {
      feito.disabled = true;
      try { await post('/api/v1/lembretes/ocorrencias/' + encodeURIComponent(feito.dataset.feito) + '/feito', {}); carrega(); }
      catch (e) { feito.disabled = false; msg('Não consegui marcar como feito: ' + e.message + '.', true); }
    }
  }

  async function cria(tipo, botao) {
    const frase = el.querySelector('#bhFrase'), t = frase.value.trim(), agente = el.querySelector('#bhAgente').value;
    if (!t) { msg('Escreva primeiro o que é.', true); frase.focus(); return; }
    botao.disabled = true;
    try {
      if (tipo === 'lembrete') {
        const r = entendeFrase(t, new Date());
        if (!r || !r.texto) { msg('Não entendi quando. Exemplos: "amanhã às 9h de ligar pro contador", "daqui a 30 min tirar o bolo".', true); return; }
        await post('/api/v1/lembretes', Object.assign({ texto: r.texto, agente }, r.regra ? { regra: r.regra } : { daqui_min: r.daqui_min }));
        msg(`Lembrete criado para ${descreve(r, new Date())}.`);
      } else {
        const a = new Date();
        await post('/api/v1/tarefas', { agente, titulo: t.slice(0, 120), origem: `Dono, ${pad2(a.getDate())}/${pad2(a.getMonth() + 1)} ${pad2(a.getHours())}h${pad2(a.getMinutes())}: ${t}`.slice(0, 300) });
        const n = (agentes.find(x => x.id === agente) || {}).nome || agente;
        msg(`Tarefa criada para ${n}. Ele foi avisado.`);
      }
      frase.value = ''; el.querySelector('#bhEntendi').textContent = '';
      carrega();
    } catch (e) {
      msg('Não deu certo: ' + e.message + '.', true);
    } finally { botao.disabled = false; }
  }

  async function carrega() {
    if (!el) return;
    try {
      const [ag, tf, lb, cx] = await Promise.all([
        api('/api/v1/agents'),
        api('/api/v1/tarefas'),
        api('/api/v1/lembretes').catch(() => ({ lembretes: [], insistindo: [] })),
        api('/api/v1/caixa').catch(() => ({ total: 0 })),
      ]);
      agentes = ag.agentes || [];
      const sel = el.querySelector('#bhAgente');
      if (sel && !sel.options.length) {
        sel.innerHTML = agentes.map(a => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join('');
        sel.value = agentePadrao();
      }
      pinta(tf.tarefas || [], lb, cx.total || 0);
    } catch (e) {
      el.querySelector('#bhDia').innerHTML = `<p class="bh-msg erro">Não consegui carregar o seu dia: ${esc(e.message)}. Tento de novo em instantes.</p>`;
    }
  }

  function pinta(tarefas, lb, pedidosCaixa) {
    const hoje = new Date(), h0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime(), h1 = h0 + 86400000;
    const tocando = (lb.insistindo || []);
    const doDia = (lb.lembretes || []).filter(l => l.estado === 'ativo' && l.proxima && (t => t >= h0 && t < h1)(new Date(l.proxima).getTime()))
      .sort((a, b) => new Date(a.proxima) - new Date(b.proxima));
    const chipsL = tocando.map(o => `<div class="bh-lb tocando"><span>${ICO.relogio}agora</span><b>${esc(o.texto)}</b><button type="button" class="bh-mini" data-feito="${esc(o.id)}">Feito</button></div>`)
      .concat(doDia.map(l => { const d = new Date(l.proxima); return `<div class="bh-lb"><span>${ICO.relogio}${pad2(d.getHours())}:${pad2(d.getMinutes())}</span><b>${esc(l.texto)}</b></div>`; }));
    const esperando = tarefas.filter(t => t.estado === 'esperando_dono' || t.estado === 'esperando_danilo');
    const fazendo = tarefas.filter(t => t.estado === 'fazendo' || t.estado === 'travada');
    const pronto = tarefas.filter(t => t.estado === 'concluida');
    const linha = (t, extra) => `<a class="bh-t${t.estado === 'travada' ? ' travada' : ''}" href="#t${esc(t.id)}">${foto(t.agente)}<span class="bh-tt"><b>${esc(t.titulo)}</b>` +
      (extra || '') + `</span><span class="bh-ir">${ICO.seta}</span></a>`;
    const sec = (icone, titulo, n, corpo) => `<div class="bh-sec">${icone}${titulo}${n != null ? `<span class="q">${n}</span>` : ''}</div>${corpo}`;
    const grupo = (itens) => `<div class="bh-grupo">${itens}</div>`;
    let html = sec(ICO.sino, 'Seus lembretes de hoje', chipsL.length || null, chipsL.length ? `<div class="bh-lbs">${chipsL.join('')}</div>` : '<p class="bh-fraco">Nenhum lembrete para hoje.</p>');
    const caixa = pedidosCaixa ? `<a class="bh-t bh-caixa" href="/caixa"><span class="bh-av ico">${ICO.caixa}</span><span class="bh-tt"><b>${pedidosCaixa} ${pedidosCaixa === 1 ? 'item' : 'itens'} na Caixa de entrada</b><small>pedidos e entregas dos agentes</small></span><span class="bh-ir">${ICO.seta}</span></a>` : '';
    html += sec(ICO.espera, 'Esperando você', (esperando.length + (pedidosCaixa ? 1 : 0)) || null,
      (esperando.length || caixa) ? grupo(caixa + esperando.map(t => linha(t, t.motivo ? `<small>${esc(t.motivo)}</small>` : '')).join('')) : '<p class="bh-fraco">Nada esperando você.</p>');
    html += sec(ICO.fazendo, 'Agentes fazendo', fazendo.length || null, fazendo.length ? grupo(fazendo.map(t => linha(t,
      (t.nota ? `<small>${esc(t.nota)}</small>` : t.estado === 'travada' && t.motivo ? `<small>travada: ${esc(t.motivo)}</small>` : '') +
      (typeof t.progresso === 'number' ? `<span class="bh-prog"><i style="width:${Math.max(2, Math.min(100, t.progresso))}%"></i></span>` : ''))).join('')) : '<p class="bh-fraco">Nenhum agente com tarefa aberta agora.</p>');
    if (pronto.length) html += sec(ICO.pronto, 'Pronto hoje', pronto.length, grupo(pronto.map(t => linha(t)).join('')));
    el.querySelector('#bhDia').innerHTML = html;
  }

  return { entendeFrase, descreve, montar };
});
