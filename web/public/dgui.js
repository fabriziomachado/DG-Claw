'use strict';
/* dgui.js: componentes de UI generativa na conversa (18/10/2026).

   O agente não escreve página: manda os dados num bloco ```dgui com JSON, e a tela desenha
   componentes prontos (KPI, tabela e gráfico) com a paleta do sistema (tema.css), nos dois
   temas, no celular e no computador. Mesmo caminho do ```dgcofre: o conversa.js chama
   dgui.blocoParaHtml(corpo) para cada bloco cercado por crases.

   Formato (um componente, uma lista deles, ou um painel):
     {"tipo":"kpi","titulo":"Evasão EAD","valor":"65,3%","variacao":"+4,1 p.p.","tendencia":"alta",
      "bom":"baixa","legenda":"cursos com 100+ matrículas"}
     {"tipo":"tabela","titulo":"...","colunas":["Curso","Evadidos",{"nome":"%","alinha":"direita"}],
      "linhas":[["Direito",206,"7,5%"]],"ordenavel":true}
     {"tipo":"grafico","forma":"barras|colunas|linhas|pizza","titulo":"...","unidade":"%",
      "categorias":["Direito","Psicologia"],"series":[{"nome":"Evasão","valores":[7.5,8.5]}]}
     {"tipo":"painel","titulo":"...","itens":[ ...componentes... ]}

   Tudo que vem do agente é dado: todo texto sai escapado e todo número é conferido. JSON
   inválido vira um aviso discreto com o bloco cru, para o agente (e o dono) verem o erro. */
(function (raiz) {
  const LIMITE = { itens: 24, linhas: 300, colunas: 12, series: 6, pontos: 80, texto: 300 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const txt = (v) => esc(String(v == null ? '' : v).slice(0, LIMITE.texto));
  // "1.234,5", "65,3%", "R$ 10" ou número: devolve o número, ou null
  function numero(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    let s = v.replace(/[%\s]|R\$/g, '');
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    const n = Number(s);
    return s !== '' && isFinite(n) ? n : null;
  }
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('pt-BR');

  /* ── KPI ── */
  function kpi(c) {
    const t = ['alta', 'baixa', 'neutra'].includes(c.tendencia) ? c.tendencia : '';
    // "bom": qual direção é boa (evasão: baixa). Sem "bom", alta é verde.
    const bom = c.bom === 'baixa' ? 'baixa' : 'alta';
    const humor = !t || t === 'neutra' ? 'neutro' : (t === bom ? 'bom' : 'ruim');
    const seta = t === 'alta' ? '▲' : t === 'baixa' ? '▼' : '';
    return `<div class="dgui-kpi">` +
      (c.titulo ? `<div class="dgui-kpi-tit">${txt(c.titulo)}</div>` : '') +
      `<div class="dgui-kpi-valor">${txt(c.valor)}</div>` +
      (c.variacao || seta ? `<div class="dgui-kpi-var ${humor}">${seta ? `<span aria-hidden="true">${seta}</span> ` : ''}${txt(c.variacao || '')}</div>` : '') +
      (c.legenda ? `<div class="dgui-kpi-leg">${txt(c.legenda)}</div>` : '') + '</div>';
  }

  /* ── Tabela ── */
  function tabela(c) {
    const cols = (Array.isArray(c.colunas) ? c.colunas : []).slice(0, LIMITE.colunas)
      .map((x) => (x && typeof x === 'object' ? { nome: x.nome, alinha: x.alinha } : { nome: x }));
    const linhas = (Array.isArray(c.linhas) ? c.linhas : []).slice(0, LIMITE.linhas).filter(Array.isArray);
    if (!cols.length) return aviso('tabela sem "colunas"');
    const numerica = cols.map((_, i) => linhas.length > 0 && linhas.every((l) => l[i] == null || l[i] === '' || numero(l[i]) !== null));
    const alinha = (i) => {
      const a = cols[i].alinha === 'direita' || cols[i].alinha === 'right' ? 'right'
        : cols[i].alinha === 'centro' || cols[i].alinha === 'center' ? 'center'
        : numerica[i] ? 'right' : '';
      return a ? ` style="text-align:${a}"` : '';
    };
    const ordena = c.ordenavel !== false;
    return `<div class="dgui-tabela">` + (c.titulo ? `<div class="dgui-tit">${txt(c.titulo)}</div>` : '') +
      `<div class="dgui-tabela-rola"><table${ordena ? ' data-dgui-ordena="1"' : ''}><thead><tr>` +
      cols.map((col, i) => `<th${alinha(i)}${ordena ? ` data-col="${i}" tabindex="0" aria-sort="none"` : ''}>${txt(col.nome)}${ordena ? '<span class="dgui-ord" aria-hidden="true"></span>' : ''}</th>`).join('') +
      '</tr></thead><tbody>' +
      linhas.map((l) => '<tr>' + cols.map((_, i) => {
        const v = l[i]; const n = numero(v);
        return `<td${alinha(i)}${n !== null ? ` data-num="${n}"` : ''}>${typeof v === 'number' ? fmt(v) : txt(v)}</td>`;
      }).join('') + '</tr>').join('') +
      '</tbody></table></div></div>';
  }

  /* ── Gráficos (SVG desenhado aqui, sem biblioteca) ── */
  function series(c) {
    const cats = (Array.isArray(c.categorias) ? c.categorias : []).slice(0, LIMITE.pontos).map(String);
    const ss = (Array.isArray(c.series) ? c.series : []).slice(0, LIMITE.series)
      .filter((s) => s && Array.isArray(s.valores))
      .map((s, k) => ({ nome: String(s.nome || ''), cor: k, valores: cats.map((_, i) => numero(s.valores[i])) }));
    return { cats, ss };
  }
  const un = (c) => (c.unidade ? String(c.unidade).slice(0, 8) : '');
  const rot = (n, c) => (n === null ? '–' : fmt(n) + (un(c) ? (un(c) === '%' ? '%' : ' ' + un(c)) : ''));
  function legenda(ss) {
    if (ss.length < 2) return '';
    return '<div class="dgui-legenda">' + ss.map((s) => `<span><i class="dgui-c${s.cor}"></i>${txt(s.nome)}</span>`).join('') + '</div>';
  }

  // barras deitadas: o melhor para nomes longos (cursos, produtos)
  function barras(c) {
    const { cats, ss } = series(c);
    if (!cats.length || !ss.length) return aviso('gráfico sem "categorias" ou "series"');
    const max = Math.max(0, ...ss.flatMap((s) => s.valores.filter((v) => v !== null)));
    return `<div class="dgui-barras">` + cats.map((cat, i) => `<div class="dgui-barra-lin">` +
      `<div class="dgui-barra-cat" title="${txt(cat)}">${txt(cat)}</div><div class="dgui-barra-vals">` +
      ss.map((s) => {
        const v = s.valores[i]; const w = v === null || max <= 0 ? 0 : Math.max(0.5, (v / max) * 100);
        return `<div class="dgui-barra-par"><span class="dgui-barra dgui-c${s.cor}" style="width:${w.toFixed(2)}%"` +
          ` title="${txt(cat)}${s.nome ? ' · ' + txt(s.nome) : ''}: ${esc(rot(v, c))}"></span><b>${esc(rot(v, c))}</b></div>`;
      }).join('') + '</div></div>').join('') + `</div>` + legenda(ss);
  }

  // colunas e linhas: eixo com marcas, para evolução no tempo
  function eixo(c, desenha) {
    const { cats, ss } = series(c);
    if (!cats.length || !ss.length) return aviso('gráfico sem "categorias" ou "series"');
    const vals = ss.flatMap((s) => s.valores.filter((v) => v !== null));
    // escala com marcas redondas (0, 10, 20... em vez de 11,98 e 23,95)
    const bruto = (Math.max(0, ...vals) - Math.min(0, ...vals)) / 4 || 1;
    const mag = Math.pow(10, Math.floor(Math.log10(bruto))); const q = bruto / mag;
    const passoY = (q <= 1 ? 1 : q <= 2 ? 2 : q <= 2.5 ? 2.5 : q <= 5 ? 5 : 10) * mag;
    const min = Math.floor(Math.min(0, ...vals) / passoY) * passoY;
    const max = Math.ceil(Math.max(0, ...vals) / passoY) * passoY || passoY;
    const W = 640, H = 240, E = 44, B = 28, T = 10;
    const y = (v) => T + (H - T - B) * (1 - (v - min) / ((max - min) || 1));
    const passo = (W - E - 8) / cats.length;
    const marcas = []; for (let m = min; m <= max + passoY / 2; m += passoY) marcas.push(m);
    let svg = `<svg class="dgui-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${txt(c.titulo || 'gráfico')}">`;
    for (const m of marcas) {
      svg += `<line class="dgui-grade" x1="${E}" x2="${W - 4}" y1="${y(m).toFixed(1)}" y2="${y(m).toFixed(1)}"/>` +
             `<text class="dgui-eixo" x="${E - 6}" y="${(y(m) + 4).toFixed(1)}" text-anchor="end">${esc(fmt(m))}</text>`;
    }
    const cada = Math.max(1, Math.ceil(cats.length / 10));
    cats.forEach((cat, i) => {
      if (i % cada) return;
      const cx = E + passo * (i + 0.5);
      svg += `<text class="dgui-eixo" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${txt(cat.length > 12 ? cat.slice(0, 11) + '…' : cat)}</text>`;
    });
    svg += desenha({ cats, ss, y, passo, E, base: y(Math.max(min, 0)) });
    return svg + '</svg>' + legenda(ss);
  }
  function colunas(c) {
    return eixo(c, ({ cats, ss, y, passo, E, base }) => {
      const larg = (passo * 0.7) / ss.length;
      let s = '';
      cats.forEach((cat, i) => ss.forEach((se, k) => {
        const v = se.valores[i]; if (v === null) return;
        const x = E + passo * i + passo * 0.15 + larg * k;
        const yy = Math.min(y(v), base), h = Math.abs(base - y(v));
        s += `<rect class="dgui-c${se.cor}" x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${Math.max(1, larg - 2).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="3"><title>${txt(cat)}${se.nome ? ' · ' + txt(se.nome) : ''}: ${esc(rot(v, c))}</title></rect>`;
      }));
      return s;
    });
  }
  function linhas(c) {
    return eixo(c, ({ cats, ss, y, passo, E }) => ss.map((se) => {
      const pts = se.valores.map((v, i) => (v === null ? null : [E + passo * (i + 0.5), y(v), v, cats[i]])).filter(Boolean);
      return `<polyline class="dgui-linha dgui-c${se.cor}" points="${pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>` +
        pts.map((p) => `<circle class="dgui-ponto dgui-c${se.cor}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5"><title>${txt(p[3])}${se.nome ? ' · ' + txt(se.nome) : ''}: ${esc(rot(p[2], c))}</title></circle>`).join('');
    }).join(''));
  }
  function pizza(c) {
    const { cats, ss } = series(c);
    if (!cats.length || !ss.length) return aviso('gráfico sem "categorias" ou "series"');
    const vals = ss[0].valores.map((v) => (v !== null && v > 0 ? v : 0));
    const total = vals.reduce((a, b) => a + b, 0);
    if (total <= 0) return aviso('pizza sem valores positivos');
    let ang = -Math.PI / 2, svg = '<svg class="dgui-svg dgui-pizza" viewBox="0 0 200 200" role="img" aria-label="' + txt(c.titulo || 'gráfico') + '">';
    vals.forEach((v, i) => {
      if (!v) return;
      const a2 = ang + (v / total) * Math.PI * 2;
      const p = (a, r) => [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
      const [x1, y1] = p(ang, 90), [x2, y2] = p(a2, 90), [x3, y3] = p(a2, 56), [x4, y4] = p(ang, 56);
      const g = a2 - ang > Math.PI ? 1 : 0;
      const d = v === total ? 'M10,100a90,90 0 1,0 180,0a90,90 0 1,0 -180,0M44,100a56,56 0 1,1 112,0a56,56 0 1,1 -112,0'
        : `M${x1},${y1}A90,90 0 ${g} 1 ${x2},${y2}L${x3},${y3}A56,56 0 ${g} 0 ${x4},${y4}Z`;
      svg += `<path class="dgui-c${i % 6}" d="${d}"><title>${txt(cats[i])}: ${esc(rot(v, c))} (${fmt(Math.round((v / total) * 1000) / 10)}%)</title></path>`;
      ang = a2;
    });
    svg += '</svg>';
    const leg = '<div class="dgui-legenda dgui-legenda-col">' + cats.map((cat, i) => vals[i] ? `<span><i class="dgui-c${i % 6}"></i>${txt(cat)} <b>${fmt(Math.round((vals[i] / total) * 1000) / 10)}%</b></span>` : '').join('') + '</div>';
    return `<div class="dgui-pizza-caixa">${svg}${leg}</div>`;
  }
  function grafico(c) {
    const forma = String(c.forma || c.tipo_grafico || 'barras').toLowerCase();
    const corpo = forma.startsWith('linha') ? linhas(c) : forma.startsWith('coluna') ? colunas(c)
      : forma === 'pizza' || forma === 'rosca' ? pizza(c) : barras(c);
    return `<div class="dgui-grafico">${c.titulo ? `<div class="dgui-tit">${txt(c.titulo)}</div>` : ''}${corpo}</div>`;
  }

  function aviso(m) { return `<div class="dgui-aviso">Não consegui desenhar este componente: ${esc(m)}.</div>`; }

  function componente(c, fundo) {
    if (!c || typeof c !== 'object') return '';
    if (Array.isArray(c)) return grade(c, fundo);
    if (c.tipo === 'kpi') return kpi(c);
    if (c.tipo === 'tabela') return tabela(c);
    if (c.tipo === 'grafico' || c.tipo === 'gráfico') return grafico(c);
    if (c.tipo === 'painel') return `<div class="dgui-painel">${c.titulo ? `<div class="dgui-painel-tit">${txt(c.titulo)}</div>` : ''}${grade(c.itens || [], fundo)}</div>`;
    return aviso('tipo "' + String(c.tipo || '').slice(0, 20) + '" desconhecido (use kpi, tabela, grafico ou painel)');
  }
  // KPIs seguidos ficam lado a lado numa fileira; o resto ocupa a largura toda
  function grade(itens, fundo) {
    if (fundo > 3) return '';
    let html = '', kpis = [];
    const solta = () => { if (kpis.length) html += `<div class="dgui-kpis">${kpis.join('')}</div>`; kpis = []; };
    for (const it of itens.slice(0, LIMITE.itens)) {
      if (it && it.tipo === 'kpi') kpis.push(kpi(it)); else { solta(); html += componente(it, fundo + 1); }
    }
    solta();
    return html;
  }

  /* Corpo do bloco (o que vem depois de ```): HTML seguro, ou null quando não é dgui. */
  function blocoParaHtml(bloco) {
    const m = /^dgui[ \t]*\r?\n([\s\S]*)$/.exec(String(bloco));
    if (!m) return null;
    let dados;
    try { dados = JSON.parse(m[1]); } catch (e) {
      return `<div class="dgui">${aviso('o JSON do bloco está inválido (' + String(e.message).slice(0, 120) + ')')}<pre class="dgui-cru">${esc(m[1].slice(0, 2000))}</pre></div>`;
    }
    return `<div class="dgui">${componente(dados, 0)}</div>`;
  }

  /* Ordenar a tabela tocando no título (clique ou Enter). */
  function ordena(th) {
    const tab = th.closest('table'); if (!tab) return;
    const i = Number(th.dataset.col);
    const dir = th.getAttribute('aria-sort') === 'descending' ? 'ascending' : 'descending';
    tab.querySelectorAll('th[data-col]').forEach((x) => x.setAttribute('aria-sort', 'none'));
    th.setAttribute('aria-sort', dir);
    const corpo = tab.tBodies[0];
    const lins = Array.from(corpo.rows);
    lins.sort((a, b) => {
      const ca = a.cells[i], cb = b.cells[i];
      const na = ca && ca.dataset.num !== undefined ? Number(ca.dataset.num) : null;
      const nb = cb && cb.dataset.num !== undefined ? Number(cb.dataset.num) : null;
      const r = na !== null && nb !== null ? na - nb : String(ca ? ca.textContent : '').localeCompare(String(cb ? cb.textContent : ''), 'pt-BR');
      return dir === 'ascending' ? r : -r;
    });
    lins.forEach((l) => corpo.appendChild(l));
  }
  if (raiz.document) {
    raiz.document.addEventListener('click', (ev) => {
      const th = ev.target.closest && ev.target.closest('table[data-dgui-ordena] th[data-col]');
      if (th) ordena(th);
    });
    raiz.document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const th = ev.target.closest && ev.target.closest('table[data-dgui-ordena] th[data-col]');
      if (th) { ev.preventDefault(); ordena(th); }
    });
  }

  const api = { blocoParaHtml, numero };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  raiz.dgui = api;
})(typeof window !== 'undefined' ? window : globalThis);
