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
  // dados de cada gráfico/tabela desenhado, pela chave que vai no HTML (data-dgui): as
  // ferramentas (baixar, copiar, compartilhar) refazem a partir dos dados, não do desenho
  const registro = new Map();
  function chave(c) {
    const s = JSON.stringify(c); let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    const k = 'd' + h.toString(36);
    registro.set(k, c);
    return k;
  }
  const svgIco = (d) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICO = {
    baixar: svgIco('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
    copiar: svgIco('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>'),
    compartilhar: svgIco('<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12"/>'),
    ampliar: svgIco('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    fechar: svgIco('<path d="M6 6l12 12M18 6L6 18"/>'),
    ok: svgIco('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    tabela: svgIco('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>'),
    abre: svgIco('<path d="m9 6 6 6-6 6"/>'),
    luz: svgIco('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>'),
    doc: svgIco('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>')
  };
  function ferramentas(tipo) {
    const b = (acao, rotulo) => `<button type="button" class="dgui-acao" data-dgui-acao="${acao}" title="${rotulo}" aria-label="${rotulo}">${ICO[acao]}</button>`;
    return '<div class="dgui-ferr">' +
      (tipo === 'grafico' ? b('baixar', 'Baixar imagem (PNG)') + b('compartilhar', 'Compartilhar') : b('baixar', 'Baixar planilha (CSV)') + b('copiar', 'Copiar para o Excel')) +
      b('ampliar', 'Ampliar') + '</div>';
  }

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
    const k = chave(c);
    // Tabela que acompanha um gráfico no painel (19/10/2026, proposta B do dono): fica fechada num
    // rodapé fino do cartão ("Dados · título"), com copiar e baixar à mão; tocar abre ali mesmo.
    const recolhida = !!c._recolhida;
    const aberta = recolhida && dadosAbertos.has(k);
    const b = (acao, rotulo) => `<button type="button" class="dgui-acao" data-dgui-acao="${acao}" title="${rotulo}" aria-label="${rotulo}">${ICO[acao]}</button>`;
    const cab = recolhida
      ? `<div class="dgui-dados-cab"><button type="button" class="dgui-dados-abre" data-dgui-dados aria-expanded="${aberta}">${ICO.tabela}` +
        `<span class="dgui-dados-rot"><b>Dados</b> · ${c.titulo ? txt(c.titulo) : linhas.length + (linhas.length === 1 ? ' linha' : ' linhas')}</span></button>` +
        b('copiar', 'Copiar para o Excel') + b('baixar', 'Baixar planilha (CSV)') + b('ampliar', 'Ampliar') +
        `<button type="button" class="dgui-acao dgui-dados-seta" data-dgui-dados aria-label="${aberta ? 'Fechar' : 'Abrir'} os dados" title="${aberta ? 'Fechar' : 'Abrir'} os dados">${ICO.abre}</button></div>`
      : ferramentas('tabela') + (c.titulo ? `<div class="dgui-tit">${txt(c.titulo)}</div>` : '');
    return `<div class="dgui-tabela dgui-comp${recolhida ? ' dgui-recolhida' : ''}${aberta ? ' dgui-aberta' : ''}" data-dgui="${k}">` + cab +
      `<div class="dgui-tabela-rola"${recolhida && !aberta ? ' hidden' : ''}><table${ordena ? ' data-dgui-ordena="1"' : ''}><thead><tr>` +
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
  // Legenda clicável (18/10/2026): tocar numa série esconde ou mostra (classe dgui-sem-N no componente).
  function legenda(ss) {
    if (ss.length < 2) return '';
    return '<div class="dgui-legenda">' + ss.map((s) => `<button type="button" class="dgui-leg-item" data-dgui-serie="${s.cor}" aria-pressed="true" title="Mostrar ou esconder ${txt(s.nome)}"><i class="dgui-c${s.cor}"></i>${txt(s.nome)}</button>`).join('') + '</div>';
  }
  // Tocar num ponto (barra, coluna, ponto da linha, fatia) abre um balão com o valor (18/10/2026)
  const ponto = (cat, serie, val) => ` data-dgui-ponto="1" data-cat="${txt(cat)}" data-serie="${txt(serie || '')}" data-val="${esc(val)}" tabindex="0"`;

  // barras deitadas: o melhor para nomes longos (cursos, produtos)
  function barras(c) {
    const { cats, ss } = series(c);
    if (!cats.length || !ss.length) return aviso('gráfico sem "categorias" ou "series"');
    const max = Math.max(0, ...ss.flatMap((s) => s.valores.filter((v) => v !== null)));
    return `<div class="dgui-barras">` + cats.map((cat, i) => `<div class="dgui-barra-lin">` +
      `<div class="dgui-barra-cat" title="${txt(cat)}">${txt(cat)}</div><div class="dgui-barra-vals">` +
      ss.map((s) => {
        const v = s.valores[i]; const w = v === null || max <= 0 ? 0 : Math.max(0.5, (v / max) * 100);
        return `<div class="dgui-barra-par dgui-p${s.cor}"><span class="dgui-barra dgui-c${s.cor}" style="width:${w.toFixed(2)}%"${ponto(cat, s.nome, rot(v, c))}` +
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
        s += `<rect class="dgui-c${se.cor}"${ponto(cat, se.nome, rot(v, c))} x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${Math.max(1, larg - 2).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="3"><title>${txt(cat)}${se.nome ? ' · ' + txt(se.nome) : ''}: ${esc(rot(v, c))}</title></rect>`;
      }));
      return s;
    });
  }
  function linhas(c) {
    return eixo(c, ({ cats, ss, y, passo, E }) => ss.map((se) => {
      const pts = se.valores.map((v, i) => (v === null ? null : [E + passo * (i + 0.5), y(v), v, cats[i]])).filter(Boolean);
      return `<polyline class="dgui-linha dgui-c${se.cor}" points="${pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>` +
        pts.map((p) => `<circle class="dgui-ponto dgui-c${se.cor}"${ponto(p[3], se.nome, rot(p[2], c))} cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5"><title>${txt(p[3])}${se.nome ? ' · ' + txt(se.nome) : ''}: ${esc(rot(p[2], c))}</title></circle>`).join('');
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
      svg += `<path class="dgui-c${i % 6}"${ponto(cats[i], '', rot(v, c) + ' (' + fmt(Math.round((v / total) * 1000) / 10) + '%)')} d="${d}"><title>${txt(cats[i])}: ${esc(rot(v, c))} (${fmt(Math.round((v / total) * 1000) / 10)}%)</title></path>`;
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
    return `<div class="dgui-grafico dgui-comp" data-dgui="${chave(c)}">${ferramentas('grafico')}${c.titulo ? `<div class="dgui-tit">${txt(c.titulo)}</div>` : ''}${corpo}${rodape(c)}</div>`;
  }

  // "Power BI · DB_Evasão · atualizado em 22/07/2025"
  function rodape(c) {
    if (c._semRodape) return '';
    const f = [c.fonte, c.atualizado ? 'atualizado em ' + c.atualizado : ''].filter(Boolean).map((x) => txt(x)).join(' · ');
    return f ? `<div class="dgui-fonte">${f}</div>` : '';
  }
  // botões de pergunta pronta embaixo do componente: um toque manda ao agente
  const ICO_SUG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
  const ICO_SETA = '<svg class="dgui-sug-seta" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';
  // Sem sugestões do agente, o painel ganha perguntas de análise que servem para qualquer dado:
  // o dono nunca fica sem um próximo passo.
  function sugestoesPadrao(dados) {
    const itens = dados && dados.tipo === 'painel' ? (dados.itens || []) : [dados];
    const temSeries = itens.some((it) => it && it.tipo === 'grafico' && Array.isArray(it.series) && it.series.length > 1);
    const oQue = dados && dados.tipo === 'painel' ? 'este painel' : dados && dados.tipo === 'tabela' ? 'esta tabela' : 'este gráfico';
    return ['Interprete ' + oQue, 'Quais são os 3 principais pontos de atenção?',
      temSeries ? 'Explique as maiores variações entre os períodos' : 'O que explica os números mais altos?',
      'Que ações você recomenda a partir destes dados?'];
  }
  function sugestoes(lista) {
    const ok = (Array.isArray(lista) ? lista : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 4);
    if (!ok.length) return '';
    return '<div class="dgui-sugestoes" role="group" aria-label="Continue a análise"><div class="dgui-sug-tit">' + ICO_SUG + 'Continue a análise</div>' +
      ok.map((q) => `<button type="button" class="dgui-sugestao" data-dgui-pergunta="${esc(q.trim().slice(0, 200))}"><span>${txt(q.trim().slice(0, 200))}</span>${ICO_SETA}</button>`).join('') + '</div>';
  }

  /* ── Leitura (insights): destaques sempre à vista e a análise completa recolhida ── */
  // **negrito** dentro do texto, já escapado; quebra dupla vira parágrafo, linha "- " vira item
  function textoSimples(t) {
    const bold = (x) => esc(x).replace(/\*\*([^*]{1,200})\*\*/g, '<b>$1</b>');
    const RX_ITEM = /^\s*([-•]|\d+[.)])\s+/;
    return String(t || '').slice(0, 6000).split(/\n{2,}/).map((p) => {
      // dentro do parágrafo, linhas "- " seguidas viram lista; o resto, texto com quebra de linha
      let html = '', texto = [], itens = [];
      const soltaTexto = () => { if (texto.length) html += '<p>' + texto.map(bold).join('<br>') + '</p>'; texto = []; };
      const soltaItens = () => { if (itens.length) html += '<ul>' + itens.map((l) => '<li>' + bold(l.replace(RX_ITEM, '')) + '</li>').join('') + '</ul>'; itens = []; };
      for (const l of p.split('\n')) {
        if (RX_ITEM.test(l)) { soltaTexto(); itens.push(l); } else { soltaItens(); texto.push(l); }
      }
      soltaTexto(); soltaItens();
      return html;
    }).join('');
  }
  const icoTraco = (d) => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  // ícones de traço fino, na cor do texto secundário (sem cor: o sentido vem do desenho)
  const ICO_LEITURA = {
    alerta: icoTraco('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/>'),
    queda: icoTraco('<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>'),
    alta: icoTraco('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
    ideia: icoTraco('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'),
    ok: icoTraco('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>'),
    info: icoTraco('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.1"/>'),
  };
  function leitura(c) {
    const dest = (Array.isArray(c.destaques) ? c.destaques : []).slice(0, 5).map((d) => (typeof d === 'string' ? { texto: d } : d || {}))
      .filter((d) => d.texto);
    const ico = (d) => ICO_LEITURA[d.tipo] || ICO_LEITURA.info;
    return `<div class="dgui-leitura">` +
      `<div class="dgui-leitura-tit">${txt(c.titulo || 'Leitura do especialista')}</div>` +
      (dest.length ? '<ul class="dgui-destaques">' + dest.map((d) => `<li>${ico(d)}<span>${txt(d.texto)}</span></li>`).join('') + '</ul>' : '') +
      (c.detalhe ? (dest.length
        ? `<details class="dgui-leitura-det"><summary>Ver análise completa</summary><div class="dgui-leitura-txt">${textoSimples(c.detalhe)}</div></details>`
        : `<div class="dgui-leitura-txt">${textoSimples(c.detalhe)}</div>`) : '') +
      '</div>';
  }

  /* Leitura dentro do cartão do painel (19/10/2026, proposta A do dono): no pé do cartão, antes dos
     Dados, ela vira duas faixas fechadas iguais à dos Dados, "Leitura do especialista · N destaques" e
     "Análise completa"; um toque abre ali mesmo. Fora de um painel a leitura continua um bloco aberto. */
  function faixa(c, parte, ico, rotulo, sub, corpo) {
    const k = 'f' + chaveTexto(parte + JSON.stringify(c));
    const aberta = dadosAbertos.has(k);
    return `<div class="dgui-comp dgui-faixa dgui-recolhida${aberta ? ' dgui-aberta' : ''}" data-dgui="${k}">` +
      `<div class="dgui-dados-cab"><button type="button" class="dgui-dados-abre" data-dgui-dados aria-expanded="${aberta}">${ICO[ico]}` +
      `<span class="dgui-dados-rot"><b>${rotulo}</b>${sub ? ' · ' + sub : ''}</span></button>` +
      `<button type="button" class="dgui-acao dgui-dados-seta" data-dgui-dados aria-label="${aberta ? 'Fechar' : 'Abrir'}" title="${aberta ? 'Fechar' : 'Abrir'}">${ICO.abre}</button></div>` +
      `<div class="dgui-faixa-corpo"${aberta ? '' : ' hidden'}>${corpo}</div></div>`;
  }
  function leituraEmFaixas(c) {
    const dest = (Array.isArray(c.destaques) ? c.destaques : []).slice(0, 5).map((d) => (typeof d === 'string' ? { texto: d } : d || {}))
      .filter((d) => d.texto);
    const ico = (d) => ICO_LEITURA[d.tipo] || ICO_LEITURA.info;
    let html = '';
    if (dest.length) {
      html += faixa(c, 'leitura', 'luz', txt(c.titulo || 'Leitura do especialista'), dest.length + (dest.length === 1 ? ' destaque' : ' destaques'),
        '<ul class="dgui-destaques">' + dest.map((d) => `<li>${ico(d)}<span>${txt(d.texto)}</span></li>`).join('') + '</ul>');
    }
    if (c.detalhe) {
      html += faixa(c, 'analise', 'doc', dest.length ? 'Análise completa' : txt(c.titulo || 'Leitura do especialista'), '',
        `<div class="dgui-leitura-txt">${textoSimples(c.detalhe)}</div>`);
    }
    return html;
  }

  /* ── Escolha: o agente pede uma decisão e mostra as opções numa lista para tocar, como o
     Claude faz. Um toque manda a opção como resposta; "Outra resposta" leva ao campo. ── */
  const LETRAS = 'ABCDEFGH';
  function escolha(c) {
    const ops = (Array.isArray(c.opcoes) ? c.opcoes : []).slice(0, 8)
      .map((o) => (typeof o === 'string' ? { texto: o } : o || {})).filter((o) => o.texto);
    if (!ops.length) return aviso('escolha sem "opcoes"');
    const chave = 'e' + chaveTexto(JSON.stringify(c));
    return `<div class="dgui-escolha" data-escolha="${chave}">` +
      (c.pergunta ? `<div class="dgui-escolha-perg">${txt(c.pergunta)}</div>` : '') +
      '<div class="dgui-escolha-ops" role="list">' + ops.map((o, i) =>
        `<button type="button" class="dgui-op" role="listitem" data-dgui-opcao="${esc(String(o.texto).slice(0, 200))}">` +
        `<span class="dgui-op-letra">${LETRAS[i]}</span><span class="dgui-op-txt"><b>${txt(o.texto)}${o.recomendada ? ' <span class="dgui-op-rec">Recomendada</span>' : ''}</b>` +
        (o.detalhe ? `<small>${txt(o.detalhe)}</small>` : '') + '</span></button>').join('') +
      `<button type="button" class="dgui-op dgui-op-outra" data-dgui-outra="1"><span class="dgui-op-letra">✎</span><span class="dgui-op-txt"><b>Outra resposta</b><small>escrever do meu jeito</small></span></button>` +
      '</div></div>';
  }
  /* ── Para o Admin (23/10/2026, pedido do dono): o relatório de segurança do Tech fecha com um
     botão; o toque do dono manda ao Admin um pedido de texto fixo, montado pela conversa.js. O
     agente só diz a data do relatório, e nada do que ele escreve chega ao Admin. ── */
  function paraAdmin(c) {
    const data = String(c.relatorio || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return aviso('para-admin sem "relatorio" no formato AAAA-MM-DD');
    const [a, m, d] = data.split('-');
    return `<div class="dgui-escolha dgui-para-admin" data-escolha="pa${a}${m}${d}">` +
      `<div class="dgui-escolha-perg">Relatório de segurança de ${d}/${m}/${a}</div>` +
      '<div class="dgui-escolha-ops">' +
      `<button type="button" class="dgui-op" data-dgui-para-admin="${data}"><span class="dgui-op-letra">${svgIco('<path d="M4 12 20 4l-6 16-3-7z"/>')}</span>` +
      '<span class="dgui-op-txt"><b>Mandar para o Admin aplicar</b><small>Ele aplica o que é seguro e pergunta antes do resto</small></span></button>' +
      '</div></div>';
  }
  /* ── Carrossel (19/10/2026, pedido do dono): variantes, propostas ou cenários lado a lado, um
     cartão por vez. Cada item: { titulo, detalhe, imagem (só do próprio DG Claw, "/..."), conteudo
     (um componente ou uma lista deles), recomendada }. Com "escolher": true, cada cartão tem
     "Escolher esta", que chega ao agente como a resposta do dono. O deslizar é rolagem nativa
     (scroll-snap); as setas e os pontinhos são do controlador ligaCarrosseis. */
  function htmlCarrossel(slides, extraCls) {
    const n = slides.length;
    return `<div class="dg-car${extraCls ? ' ' + extraCls : ''}" data-dg-car="${n}">` +
      `<div class="dg-car-trilho" tabindex="0" aria-roledescription="carrossel">${slides.join('')}</div>` +
      (n > 1 ? `<button type="button" class="dg-car-seta ant" data-dg-car-ir="-1" aria-label="Anterior" hidden>${svgIco('<path d="m15 6-6 6 6 6"/>')}</button>` +
        `<button type="button" class="dg-car-seta prox" data-dg-car-ir="1" aria-label="Próximo">${svgIco('<path d="m9 6 6 6-6 6"/>')}</button>` +
        `<div class="dg-car-pts" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>` : '') +
      '</div>';
  }
  function carrossel(c, fundo) {
    const itens = (Array.isArray(c.itens) ? c.itens : []).filter((x) => x && typeof x === 'object').slice(0, 12);
    if (!itens.length) return aviso('carrossel sem "itens"');
    const n = itens.length;
    const slides = itens.map((it, i) => {
      const img = typeof it.imagem === 'string' && /^\/(?!\/)/.test(it.imagem) ? `<img class="dg-car-img" loading="lazy" alt="" src="${esc(it.imagem)}">` : '';
      const cont = it.conteudo ? `<div class="dg-car-cont-int">${componente(Array.isArray(it.conteudo) ? it.conteudo : it.conteudo, (fundo || 0) + 1)}</div>` : '';
      const titulo = String(it.titulo || 'Opção ' + (i + 1));
      return `<div class="dg-car-sl${it.recomendada ? ' rec' : ''}" role="group" aria-label="${txt(i + 1 + ' de ' + n + ': ' + titulo)}">${img}${cont}` +
        `<div class="dg-car-tx"><div class="dg-car-k">${i + 1} de ${n}${it.recomendada ? ' · <span>recomendada</span>' : ''}</div>` +
        `<div class="dg-car-t">${txt(titulo)}</div>${it.detalhe ? `<div class="dg-car-d">${txt(it.detalhe)}</div>` : ''}` +
        (c.escolher ? `<button type="button" class="dg-car-esc" data-dgui-opcao="${esc(('Escolho: ' + titulo).slice(0, 200))}">Escolher esta</button>` : '') +
        '</div></div>';
    });
    const corpo = (c.titulo ? `<div class="dgui-painel-tit">${txt(c.titulo)}</div>` : '') + htmlCarrossel(slides);
    return c.titulo ? `<div data-dg-pergunta="${esc(String(c.titulo).slice(0, 160))}">${corpo}</div>` : corpo;
  }
  // Pontinhos, contador e setas acompanham a rolagem do trilho (qualquer .dg-car da página)
  function ligaCarrosseis(doc) {
    const atual = (tr) => {
      const sl = tr.children; if (!sl.length) return 0;
      const x = tr.scrollLeft + 4; let i = 0;
      for (let k = 0; k < sl.length; k++) if (sl[k].offsetLeft - tr.offsetLeft <= x) i = k;
      if (tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 4) i = sl.length - 1;
      return i;
    };
    const pinta = (car) => {
      const tr = car.querySelector('.dg-car-trilho'); if (!tr) return;
      const i = atual(tr), n = tr.children.length;
      car.querySelectorAll('.dg-car-pts i').forEach((p, k) => p.classList.toggle('on', k === i));
      const a = car.querySelector('.dg-car-seta.ant'), b = car.querySelector('.dg-car-seta.prox');
      if (a) a.hidden = i === 0; if (b) b.hidden = i >= n - 1;
    };
    doc.addEventListener('scroll', (ev) => {
      const tr = ev.target && ev.target.classList && ev.target.classList.contains('dg-car-trilho') ? ev.target : null;
      if (tr) pinta(tr.closest('.dg-car'));
    }, true);
    doc.addEventListener('click', (ev) => {
      const b = ev.target.closest && ev.target.closest('[data-dg-car-ir]'); if (!b) return;
      const car = b.closest('.dg-car'), tr = car && car.querySelector('.dg-car-trilho'); if (!tr) return;
      // pela posição de cada cartão, e não pelo "atual": no computador cabem dois cartões, e no fim o
      // "atual" é o último, então voltar um caía no mesmo lugar e a seta de voltar não andava (21/10/2026)
      const x = tr.scrollLeft, pos = [...tr.children].map((c) => c.offsetLeft - tr.offsetLeft);
      const alvo = Number(b.dataset.dgCarIr) < 0
        ? pos.filter((p) => p < x - 4).pop()
        : pos.find((p) => p > x + 4);
      tr.scrollTo({ left: alvo == null ? (Number(b.dataset.dgCarIr) < 0 ? 0 : tr.scrollWidth) : alvo, behavior: 'smooth' });
    });
    doc.addEventListener('keydown', (ev) => {
      const tr = ev.target && ev.target.classList && ev.target.classList.contains('dg-car-trilho') ? ev.target : null;
      if (!tr || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
      ev.preventDefault();
      const btn = tr.closest('.dg-car').querySelector('[data-dg-car-ir="' + (ev.key === 'ArrowLeft' ? '-1' : '1') + '"]');
      if (btn) btn.click();
    });
  }

  /* ── Passos (19/10/2026): passo a passo na própria conversa, numerado e ligado por uma linha fina.
     Cada item: { titulo, texto, codigo, lingua }. O código sai no mesmo bloco da conversa (barra com a
     língua e o Copiar, cores de sintaxe pelo highlight.js da página). */
  const NOME_LINGUA = { bash: 'Bash', sh: 'Shell', shell: 'Shell', js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', py: 'Python', python: 'Python', php: 'PHP', sql: 'SQL', json: 'JSON', yaml: 'YAML', html: 'HTML', css: 'CSS' };
  const ICO_COPIA = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>';
  function htmlCodigo(cod, lingua) {
    const l = String(lingua || '').toLowerCase();
    const h = raiz.hljs;
    let cor = null;
    if (h && l && h.getLanguage(l)) { try { cor = h.highlight(cod, { language: l, ignoreIllegals: true }).value; } catch (_) { cor = null; } }
    return `<div class="cod"><div class="cod-bar"><span class="cod-lingua">${esc(NOME_LINGUA[l] || l || 'texto')}</span>` +
      `<button type="button" class="codcopia" aria-label="Copiar o código" title="Copiar o código">${ICO_COPIA}<span>Copiar</span></button></div>` +
      `<pre${cor != null ? ' class="hljs"' : ''}>${cor != null ? cor : esc(cod)}</pre></div>`;
  }
  function passos(c) {
    const itens = (Array.isArray(c.itens) ? c.itens : []).filter((x) => x && typeof x === 'object').slice(0, 20);
    if (!itens.length) return aviso('passos sem "itens"');
    return (c.titulo ? `<div class="dgui-painel-tit">${txt(c.titulo)}</div>` : '') + '<ol class="dg-passos">' + itens.map((it) =>
      `<li><b>${txt(it.titulo || '')}</b>${it.texto ? `<small>${txt(it.texto)}</small>` : ''}` +
      (typeof it.codigo === 'string' && it.codigo.trim() ? htmlCodigo(it.codigo.replace(/\s+$/, ''), it.lingua) : '') + '</li>').join('') + '</ol>';
  }

  function chaveTexto(t) { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); }

  const dadosAbertos = new Set();   // tabelas recolhidas que a pessoa abriu (sobrevive ao redesenho)
  function aviso(m) { return `<div class="dgui-aviso">Não consegui desenhar este componente: ${esc(m)}.</div>`; }

  function componente(c, fundo) {
    if (!c || typeof c !== 'object') return '';
    if (Array.isArray(c)) return grade(c, fundo);
    if (c.tipo === 'kpi') return kpi(c);
    if (c.tipo === 'tabela') return tabela(c);
    if (c.tipo === 'grafico' || c.tipo === 'gráfico') return grafico(c);
    if (c.tipo === 'leitura') return leitura(c);
    if (c.tipo === 'escolha') return escolha(c);
    if (c.tipo === 'para-admin') return paraAdmin(c);
    if (c.tipo === 'carrossel') return carrossel(c, fundo);
    if (c.tipo === 'passos') return passos(c);
    if (c.tipo === 'painel' && c.vivo && !c._vivoDentro && fundo === 0) return painelVivo(c, fundo);
    if (c.tipo === 'painel' && Array.isArray(c.filtros) && c.filtros.length && c.variantes && typeof c.variantes === 'object') return painelComFiltros(c, fundo);
    if (c.tipo === 'painel') {
      // a fonte do painel vale para os gráficos de dentro (sai na imagem baixada), sem repetir na tela
      const herda = (Array.isArray(c.itens) ? c.itens : []).map((it) => (it && typeof it === 'object' && !Array.isArray(it) && !it.fonte && c.fonte
        ? Object.assign({}, it, { fonte: c.fonte, atualizado: it.atualizado || c.atualizado, _semRodape: true }) : it));
      // a leitura do especialista sai do cartão e fica logo abaixo dele, como bloco próprio
      const leituras = herda.filter((it) => it && it.tipo === 'leitura');
      let resto = herda.filter((it) => !(it && it.tipo === 'leitura'));
      // com gráfico no painel, a tabela são os dados dele: vai fechada para o pé do cartão
      const ehTab = (it) => it && it.tipo === 'tabela';
      const temGrafico = resto.some((it) => it && (it.tipo === 'grafico' || it.tipo === 'gráfico'));
      const dados = temGrafico ? resto.filter(ehTab).map((it) => tabela(Object.assign({}, it, { _recolhida: true }))).join('') : '';
      if (dados) resto = resto.filter((it) => !ehTab(it));
      const faixas = leituras.map(leituraEmFaixas).join('') + dados;
      const pe = faixas ? `<div class="dgui-dados">${faixas}</div>` : '';
      if (c._semTitulo) return grade(resto, fundo) + pe;
      return `<div class="dgui-painel">${c.titulo ? `<div class="dgui-painel-tit">${txt(c.titulo)}</div>` : ''}${grade(resto, fundo)}${rodape(c)}${pe}</div>`;
    }
    return aviso('tipo "' + String(c.tipo || '').slice(0, 20) + '" desconhecido (use kpi, tabela, grafico ou painel)');
  }
  /* Filtros no painel (18/10/2026, ideia 3): o agente manda "filtros" ([{nome, opcoes, padrao}]) e
     "variantes" ({"2025|Proen": [itens]}, a chave é a escolha de cada filtro na ordem, unida por "|").
     Trocar o filtro só troca os itens desenhados, com os dados que já vieram; a escolha fica guardada
     por painel (selecoes) para sobreviver ao redesenho da conversa. */
  const selecoes = new Map();
  const filtrosDe = (c) => c.filtros.slice(0, 3).map((f) => ({ nome: String(f.nome || ''), opcoes: (Array.isArray(f.opcoes) ? f.opcoes : []).map(String).slice(0, 40), padrao: f.padrao != null ? String(f.padrao) : null }))
    .filter((f) => f.opcoes.length);
  function corpoFiltrado(c, sel, fundo) {
    const itens = c.variantes[sel.join('|')];
    if (!Array.isArray(itens)) return `<div class="dgui-aviso dgui-sem-dados">Sem dados para ${esc(sel.join(' · '))}.</div>`;
    return componente(normaliza({ tipo: 'painel', itens, fonte: c.fonte, atualizado: c.atualizado, _semTitulo: true }, 1), fundo + 1);
  }
  function painelComFiltros(c, fundo) {
    const fs = filtrosDe(c);
    const k = chave({ f: c.filtros, t: c.titulo, v: Object.keys(c.variantes) });
    registro.set(k, c);
    let sel = selecoes.get(k);
    if (!sel) { sel = fs.map((f) => (f.padrao && f.opcoes.includes(f.padrao) ? f.padrao : f.opcoes[0])); selecoes.set(k, sel); }
    const barra = fs.map((f, i) => (f.opcoes.length <= 5
      ? `<div class="dgui-filtro" role="group" aria-label="${txt(f.nome)}">` + f.opcoes.map((o) => `<button type="button" class="dgui-fchip" data-dgui-filtro="${k}" data-fi="${i}" data-fv="${txt(o)}" aria-pressed="${o === sel[i]}">${txt(o)}</button>`).join('') + '</div>'
      : `<label class="dgui-filtro dgui-fsel"><span>${txt(f.nome)}</span><select data-dgui-filtro="${k}" data-fi="${i}">` + f.opcoes.map((o) => `<option${o === sel[i] ? ' selected' : ''}>${txt(o)}</option>`).join('') + '</select></label>')).join('');
    return `<div class="dgui-painel dgui-painel-filtros" data-dgui-painel="${k}">${c.titulo ? `<div class="dgui-painel-tit">${txt(c.titulo)}</div>` : ''}` +
      `<div class="dgui-filtros">${barra}</div><div class="dgui-painel-corpo">${corpoFiltrado(c, sel, fundo)}</div>${rodape(c)}</div>`;
  }
  function trocaFiltro(el, valor) {
    const k = el.dataset.dguiFiltro, i = Number(el.dataset.fi);
    const c = registro.get(k), sel = selecoes.get(k);
    if (!c || !sel) return;
    sel[i] = valor;
    for (const caixa of raiz.document.querySelectorAll('[data-dgui-painel="' + k + '"]')) {
      caixa.querySelectorAll('.dgui-fchip[data-fi="' + i + '"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fv === valor)));
      const corpo = caixa.querySelector('.dgui-painel-corpo');
      if (corpo) corpo.innerHTML = corpoFiltrado(c, sel, 0);
    }
  }

  /* Painel que se atualiza (18/10/2026, ideia 4): "vivo": {"id", "a_cada_min"}. O agente deixa um
     script em ~/.dgclaw/paineis/<id>.sh que imprime o painel; o Web roda e guarda (paineis-vivos.js).
     A tela mostra a versão mais nova que já tem (vivoCache) e, quando passa do intervalo, pede outra.
     Discreto, como o dono pediu: "atualizado há 3 min" e um ícone de atualizar. */
  const RX_VIVO = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const vivoCache = new Map();   // "agente/id" -> { painel, atualizado }
  const agenteDaTela = () => raiz.DGUI_AGENTE || ((/^\/a\/([^/]+)/.exec((raiz.location && raiz.location.pathname) || '') || [])[1] || '');
  const ICO_ATU = svgIco('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>');
  function painelVivo(c, fundo) {
    const v = c.vivo || {};
    const id = String(v.id || ''), ag = agenteDaTela();
    if (!RX_VIVO.test(id) || !ag) return componente(Object.assign({}, c, { _vivoDentro: true }), fundo);
    const k = ag + '/' + id, cache = vivoCache.get(k);
    const base = cache && cache.painel && typeof cache.painel === 'object' ? normaliza(Object.assign({}, cache.painel, { tipo: 'painel' }), 0) : c;
    const min = Math.max(1, Math.min(1440, Number(v.a_cada_min) || 15));
    const quando = cache && cache.atualizado ? cache.atualizado : 0;
    return `<div class="dgui-vivo" data-dgui-vivo="${esc(k)}" data-a-cada="${min}" data-quando="${quando}">` +
      `<div class="dgui-vivo-meta"><span class="dgui-vivo-txt">${esc(textoQuando(quando))}</span>` +
      `<button type="button" class="dgui-vivo-atu" data-dgui-vivo-atu="${esc(k)}" title="Atualizar agora" aria-label="Atualizar agora">${ICO_ATU}</button></div>` +
      componente(Object.assign({}, base, { vivo: v, _vivoDentro: true }), fundo) + '</div>';
  }
  function textoQuando(ms) {
    if (!ms) return 'ainda não atualizado';
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? 'atualizado agora' : m < 60 ? `atualizado há ${m} min` : m < 1440 ? `atualizado há ${Math.floor(m / 60)} h` : `atualizado em ${new Date(ms).toLocaleDateString('pt-BR')}`;
  }
  async function vivoPede(k, atualiza) {
    const [ag, id] = k.split('/');
    const url = '/api/v1/paineis/' + encodeURIComponent(ag) + '/' + encodeURIComponent(id) + (atualiza ? '/atualizar' : '');
    const r = await fetch(url, { method: atualiza ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || d.ok === false) throw new Error((d && d.erro) || 'erro ' + r.status);
    return d;
  }
  function vivoRedesenha(k) {
    for (const el of raiz.document.querySelectorAll('[data-dgui-vivo="' + (raiz.CSS && raiz.CSS.escape ? raiz.CSS.escape(k) : k) + '"]')) {
      const c = registro.get(el.dataset.dguiVivoChave);
      if (!c) continue;
      const tmp = raiz.document.createElement('div');
      tmp.innerHTML = painelVivo(c, 0);
      const novo = tmp.firstElementChild;
      novo.dataset.dguiVivoChave = el.dataset.dguiVivoChave;
      novo.dataset.vivoVisto = '1';
      el.replaceWith(novo);
    }
  }
  const vivoAndando = new Set();
  async function vivoAtualiza(k, forcar) {
    if (vivoAndando.has(k)) return;
    vivoAndando.add(k);
    raiz.document.querySelectorAll('[data-dgui-vivo-atu="' + k + '"]').forEach((b) => b.classList.add('girando'));
    try {
      if (!forcar) {
        const d = await vivoPede(k, false);
        if (d.painel) vivoCache.set(k, { painel: d.painel, atualizado: d.atualizado });
        const el = raiz.document.querySelector('[data-dgui-vivo="' + k + '"]');
        const min = el ? Number(el.dataset.aCada) || 15 : 15;
        if (d.painel && d.atualizado && Date.now() - d.atualizado < min * 60000) { vivoRedesenha(k); return; }
      }
      const d2 = await vivoPede(k, true);
      if (d2.painel) vivoCache.set(k, { painel: d2.painel, atualizado: d2.atualizado });
      vivoRedesenha(k);
    } catch (e) {
      raiz.document.querySelectorAll('[data-dgui-vivo="' + k + '"] .dgui-vivo-txt').forEach((t) => { t.textContent = 'não consegui atualizar'; t.title = e.message; });
    } finally {
      vivoAndando.delete(k);
      raiz.document.querySelectorAll('[data-dgui-vivo-atu="' + k + '"]').forEach((b) => b.classList.remove('girando'));
    }
  }
  // Painéis vivos novos na tela: guarda os dados originais e confere se há versão mais nova.
  function vivoProcura() {
    if (!raiz.document || raiz.document.hidden) return;
    for (const el of raiz.document.querySelectorAll('[data-dgui-vivo]')) {
      const k = el.dataset.dguiVivo;
      if (!el.dataset.vivoVisto) {
        el.dataset.vivoVisto = '1';
        const comp = el.closest('.dgui');
        if (comp && !el.dataset.dguiVivoChave) {
          // a chave do painel original: refeita do bloco que a conversa desenhou
          const c = vivoOriginal.get(k);
          if (c) el.dataset.dguiVivoChave = chave(c);
        }
        vivoAtualiza(k, false);
        continue;
      }
      const t = el.querySelector('.dgui-vivo-txt');
      const q = Number(el.dataset.quando) || 0;
      if (t && q) t.textContent = textoQuando(q);
      if (q && Date.now() - q > (Number(el.dataset.aCada) || 15) * 60000) vivoAtualiza(k, true);
    }
  }
  const vivoOriginal = new Map();   // "agente/id" -> painel como veio na mensagem

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

  /* Tolerância (18/10/2026): agentes às vezes escrevem o painel de outro jeito ("componentes" no lugar
     de "itens", KPI com lista de "itens", gráfico com "formato" e "dados":[{rotulo,valor}], leitura com
     "texto", sugestões como componente). Em vez de mostrar "Não consegui desenhar", traduz para o
     formato da skill ui-generativa. O que já está no formato certo passa sem mudança. */
  function normaliza(d, fundo) {
    if (!d || typeof d !== 'object' || (fundo || 0) > 4) return d;
    if (Array.isArray(d)) return d.map((x) => normaliza(x, (fundo || 0) + 1));
    let c = Object.assign({}, d);
    if (!c.tipo && (Array.isArray(c.componentes) || Array.isArray(c.itens))) c.tipo = 'painel';
    if (c.tipo === 'gráfico') c.tipo = 'grafico';
    if (c.tipo === 'painel') {
      let sugs = Array.isArray(c.sugestoes) ? c.sugestoes : [];
      const fonte = Array.isArray(c.itens) ? c.itens : Array.isArray(c.componentes) ? c.componentes : [];
      const itens = [];
      for (const bruto of fonte) {
        const it = normaliza(bruto, (fundo || 0) + 1);
        if (!it || typeof it !== 'object') continue;
        if (it.tipo === 'sugestoes') { const l = it.itens || it.lista || it.perguntas || []; if (Array.isArray(l)) sugs = sugs.concat(l); continue; }
        if (it.tipo === 'kpis' || (it.tipo === 'kpi' && Array.isArray(it.itens) && it.valor == null)) {
          for (const k of it.itens) itens.push(normaliza(Object.assign({ tipo: 'kpi' }, k), (fundo || 0) + 1));
          continue;
        }
        itens.push(it);
      }
      c.itens = itens; delete c.componentes;
      if (sugs.length) c.sugestoes = sugs.filter((x) => typeof x === 'string');
      return c;
    }
    if (c.tipo === 'kpi') {
      const tit = c.rotulo || c.label || c.nome, leg = c.detalhe || c.descricao || c.subtitulo;
      if (c.titulo == null && tit) c.titulo = tit;
      if (c.legenda == null && leg) c.legenda = leg;
      return c;
    }
    if (c.tipo === 'grafico') {
      if (!c.forma && (c.formato || c.estilo)) c.forma = c.formato || c.estilo;
      if (!Array.isArray(c.categorias) && Array.isArray(c.dados) && c.dados.length && typeof c.dados[0] === 'object') {
        c.categorias = c.dados.map((x) => String(x.rotulo ?? x.categoria ?? x.nome ?? x.label ?? ''));
        c.series = [{ nome: c.serie || c.unidade || c.titulo || 'valor', valores: c.dados.map((x) => Number(x.valor ?? x.value ?? x.y)) }];
      }
      if (!Array.isArray(c.series) && Array.isArray(c.valores)) c.series = [{ nome: c.titulo || 'valor', valores: c.valores }];
      return c;
    }
    if (c.tipo === 'leitura') {
      if (!c.detalhe && typeof c.texto === 'string') c.detalhe = c.texto;
      return c;
    }
    if (c.tipo === 'tabela' && !Array.isArray(c.linhas) && Array.isArray(c.dados)) c.linhas = c.dados;
    return c;
  }

  /* Corpo do bloco (o que vem depois de ```): HTML seguro, ou null quando não é dgui. */
  function blocoParaHtml(bloco) {
    const m = /^dgui[ \t]*\r?\n([\s\S]*)$/.exec(String(bloco));
    if (!m) return null;
    let dados;
    try { dados = JSON.parse(m[1]); } catch (e) {
      return `<div class="dgui">${aviso('o JSON do bloco está inválido (' + String(e.message).slice(0, 120) + ')')}<pre class="dgui-cru">${esc(m[1].slice(0, 2000))}</pre></div>`;
    }
    dados = normaliza(dados, 0);
    if (dados && dados.tipo === 'painel' && dados.vivo && RX_VIVO.test(String(dados.vivo.id || '')) && agenteDaTela()) {
      vivoOriginal.set(agenteDaTela() + '/' + dados.vivo.id, dados);
    }
    const analitico = dados && !Array.isArray(dados) && ['painel', 'grafico', 'gráfico', 'tabela'].includes(dados.tipo) && dados.sugestoes !== false;  // escolha não leva sugestões; "sugestoes": false desliga
    const sug = analitico ? sugestoes(Array.isArray(dados.sugestoes) && dados.sugestoes.length ? dados.sugestoes : sugestoesPadrao(dados)) : '';
    return `<div class="dgui">${componente(dados, 0)}${sug}</div>`;
  }

  /* ── Ferramentas: baixar, copiar, compartilhar, ampliar ── */
  const formaDe = (c) => {
    const f = String(c.forma || c.tipo_grafico || 'barras').toLowerCase();
    return f.startsWith('linha') ? 'linhas' : f.startsWith('coluna') ? 'colunas' : (f === 'pizza' || f === 'rosca') ? 'pizza' : 'barras';
  };
  const nomeArquivo = (c, ext) => (String(c.titulo || 'dados').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'dados') + '.' + ext;
  const celTexto = (v) => (v == null ? '' : String(v));

  // CSV com ponto e vírgula e BOM: é o que o Excel em português abre certo com dois cliques
  function csvDe(c) {
    const q = (v) => { const t = celTexto(v); return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const cab = (c.colunas || []).map((x) => (x && typeof x === 'object' ? x.nome : x));
    return '﻿' + [cab].concat(c.linhas || []).map((l) => l.map(q).join(';')).join('\r\n');
  }
  const tsvDe = (c) => [(c.colunas || []).map((x) => (x && typeof x === 'object' ? x.nome : x))].concat(c.linhas || [])
    .map((l) => l.map((v) => celTexto(v).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');

  function baixa(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = raiz.document.createElement('a');
    a.href = url; a.download = nome; raiz.document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // O gráfico vira um SVG sozinho, com as cores do tema atual escritas por extenso (fora da
  // página as variáveis do CSS não existem), e depois PNG no dobro do tamanho.
  function svgParaImagem(c) {
    const css = getComputedStyle(raiz.document.documentElement);
    const v = (n, pad) => css.getPropertyValue(n).trim() || pad;
    const P = { fundo: v('--dg-superficie', '#fff'), txt: v('--dg-texto', '#111'), t2: v('--dg-texto-2', '#555'),
      t3: v('--dg-texto-3', '#999'), borda: v('--dg-borda', '#e5e5e5'), s: [0, 1, 2, 3, 4, 5].map((i) => v('--dg-serie-' + i, '#3b82f6')) };
    const F = 'font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif"';
    const W = 960, M = 32;
    const { cats, ss } = series(c);
    const forma = formaDe(c);
    let y = M, corpo = '';
    if (c.titulo) { corpo += `<text x="${M}" y="${y + 20}" ${F} font-size="22" font-weight="700" fill="${P.txt}">${txt(c.titulo)}</text>`; y += 44; }
    if (forma === 'barras') {
      const max = Math.max(0, ...ss.flatMap((s) => s.valores.filter((x) => x !== null)));
      const rot0 = 300, area = W - M * 2 - rot0 - 90, alt = 22;
      cats.forEach((cat, i) => {
        const y0 = y;
        corpo += `<text x="${M}" y="${y0 + 16 + (ss.length - 1) * 13}" ${F} font-size="15" fill="${P.txt}">${txt(cat.length > 38 ? cat.slice(0, 37) + '…' : cat)}</text>`;
        ss.forEach((se, k) => {
          const val = se.valores[i]; const w = val === null || max <= 0 ? 0 : Math.max(2, (val / max) * area);
          const yy = y0 + k * (alt + 4);
          corpo += `<rect x="${M + rot0}" y="${yy}" width="${w.toFixed(1)}" height="${alt}" rx="4" fill="${P.s[se.cor]}"/>` +
                   `<text x="${M + rot0 + w + 8}" y="${yy + 16}" ${F} font-size="14" font-weight="600" fill="${P.t2}">${esc(rot(val, c))}</text>`;
        });
        y += ss.length * (alt + 4) + 12;
      });
    } else {
      const html = forma === 'linhas' ? linhas(c) : forma === 'colunas' ? colunas(c) : pizza(c);
      const m = /<svg[^>]*viewBox="0 0 (\d+) (\d+)"[^>]*>([\s\S]*?)<\/svg>/.exec(html);
      if (m) {
        const vw = +m[1], vh = +m[2];
        const larg = forma === 'pizza' ? 340 : W - M * 2, alt = larg * vh / vw;
        const estilo = `<style>.dgui-grade{stroke:${P.borda}}.dgui-eixo{fill:${P.t3};font:11px Segoe UI,Roboto,Arial,sans-serif}` +
          P.s.map((cor, i) => `.dgui-c${i}{fill:${cor}}.dgui-linha.dgui-c${i}{fill:none;stroke:${cor};stroke-width:2.5}.dgui-ponto.dgui-c${i}{fill:${P.fundo};stroke:${cor};stroke-width:2}`).join('') + '</style>';
        corpo += `<svg x="${M}" y="${y}" width="${larg}" height="${alt.toFixed(0)}" viewBox="0 0 ${vw} ${vh}">${estilo}${m[3]}</svg>`;
        if (forma === 'pizza') {
          const vals = ss[0].valores.map((x) => (x !== null && x > 0 ? x : 0)); const tot = vals.reduce((a, b) => a + b, 0) || 1;
          cats.forEach((cat, i) => {
            if (!vals[i]) return;
            const ly = y + 30 + i * 30;
            corpo += `<rect x="${M + larg + 40}" y="${ly - 12}" width="14" height="14" rx="3" fill="${P.s[i % 6]}"/>` +
                     `<text x="${M + larg + 62}" y="${ly}" ${F} font-size="15" fill="${P.txt}">${txt(cat)}  ${esc(fmt(Math.round(vals[i] / tot * 1000) / 10))}%</text>`;
          });
          y += Math.max(alt, cats.length * 30 + 30) + 16;
        } else y += alt + 16;
      }
    }
    if (forma !== 'pizza' && ss.length > 1) {
      let x = M;
      ss.forEach((se) => {
        corpo += `<rect x="${x}" y="${y}" width="14" height="14" rx="3" fill="${P.s[se.cor]}"/><text x="${x + 20}" y="${y + 12}" ${F} font-size="14" fill="${P.t2}">${txt(se.nome)}</text>`;
        x += 40 + se.nome.length * 8;
      });
      y += 30;
    }
    const f = [c.fonte, c.atualizado ? 'atualizado em ' + c.atualizado : ''].filter(Boolean).join(' · ');
    if (f) { corpo += `<text x="${M}" y="${y + 12}" ${F} font-size="12" fill="${P.t3}">${txt(f)}</text>`; y += 24; }
    const H = Math.ceil(y + M / 2);
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="${P.fundo}"/>${corpo}</svg>`, W, H };
  }
  function pngDe(c) {
    const { svg, W, H } = svgParaImagem(c);
    return new Promise((ok, falha) => {
      const img = new Image();
      img.onload = () => {
        const cv = raiz.document.createElement('canvas'); cv.width = W * 2; cv.height = H * 2;
        const g = cv.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0);
        cv.toBlob((b) => (b ? ok(b) : falha(new Error('o navegador não gerou a imagem'))), 'image/png');
      };
      img.onerror = () => falha(new Error('não consegui montar a imagem do gráfico'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  function alternaSerie(btn) {
    const comp = btn.closest('.dgui-comp'); if (!comp) return;
    const n = btn.dataset.dguiSerie;
    const esconde = !comp.classList.contains('dgui-sem-' + n);
    // não deixa esconder todas: sobra pelo menos uma série à vista
    const todas = comp.querySelectorAll('[data-dgui-serie]').length;
    if (esconde && comp.querySelectorAll('[data-dgui-serie][aria-pressed="false"]').length >= todas - 1) return;
    comp.classList.toggle('dgui-sem-' + n, esconde);
    btn.setAttribute('aria-pressed', esconde ? 'false' : 'true');
  }
  function fechaBalao() { const b = raiz.document.querySelector('.dgui-balao'); if (b) b.remove(); }
  function abreBalao(pt, ev) {
    fechaBalao();
    const comp = pt.closest('.dgui-comp'); if (!comp) return;
    const c = registro.get(comp.dataset.dgui) || {};
    const cat = pt.dataset.cat || '', serie = pt.dataset.serie || '', val = pt.dataset.val || '';
    const pergunta = 'Me conte mais sobre ' + cat + (serie ? ' (' + serie + ')' : '') + (c.titulo ? ' no gráfico "' + c.titulo + '"' : '') + '.';
    const b = raiz.document.createElement('div');
    b.className = 'dgui-balao'; b.setAttribute('role', 'dialog');
    b.innerHTML = `<b>${esc(cat)}</b><span>${serie ? esc(serie) + ': ' : ''}${esc(val)}</span>` +
      `<button type="button" class="dgui-balao-perg" data-dgui-balao-pergunta="${esc(pergunta.slice(0, 300))}" title="Perguntar ao agente sobre este item">${ICO_SETA}<span>Perguntar sobre este</span></button>`;
    comp.appendChild(b);
    const rc = comp.getBoundingClientRect(), rp = pt.getBoundingClientRect();
    const x = ev && ev.clientX ? ev.clientX : rp.left + rp.width / 2, y = ev && ev.clientY ? ev.clientY : rp.top;
    const bw = b.offsetWidth, bh = b.offsetHeight;
    let left = x - rc.left - bw / 2; left = Math.max(6, Math.min(left, rc.width - bw - 6));
    let top = y - rc.top - bh - 12; if (top < 4) top = y - rc.top + 16;
    b.style.left = left + 'px'; b.style.top = top + 'px';
  }
  function confirma(btn) {
    const antes = btn.innerHTML; btn.innerHTML = ICO.ok; btn.classList.add('feito');
    setTimeout(() => { btn.innerHTML = antes; btn.classList.remove('feito'); }, 1500);
  }
  function alternaDados(comp) {
    if (!comp) return;
    const abre = !comp.classList.contains('dgui-aberta');
    comp.classList.toggle('dgui-aberta', abre);
    const rola = comp.querySelector('.dgui-tabela-rola, .dgui-faixa-corpo'); if (rola) rola.hidden = !abre;
    comp.querySelectorAll('[data-dgui-dados]').forEach((b) => {
      if (b.classList.contains('dgui-dados-abre')) b.setAttribute('aria-expanded', String(abre));
      else { const r = (abre ? 'Fechar' : 'Abrir') + ' os dados'; b.title = r; b.setAttribute('aria-label', r); }
    });
    if (abre) dadosAbertos.add(comp.dataset.dgui); else dadosAbertos.delete(comp.dataset.dgui);
  }
  async function age(btn) {
    const comp = btn.closest('.dgui-comp'); if (!comp) return;
    const c = registro.get(comp.dataset.dgui); const acao = btn.dataset.dguiAcao;
    if (acao === 'ampliar') {
      // Ampliado, o componente vai para o <body>: dentro da conversa, um balão com transform ou a
      // rolagem do #chat prendiam o position:fixed e ele abria cortado sob o topo (18/10/2026).
      // Um marcador guarda o lugar para ele voltar ao fechar.
      const doc = raiz.document;
      const aberto = !comp.classList.contains('dgui-cheio');
      // a tabela recolhida no pé do painel abre ao ampliar e volta a fechar ao sair, se estava fechada
      if (comp.classList.contains('dgui-recolhida')) {
        if (aberto && !comp.classList.contains('dgui-aberta')) { alternaDados(comp); comp._dguiAbriu = true; }
        else if (!aberto && comp._dguiAbriu) { alternaDados(comp); comp._dguiAbriu = false; }
      }
      if (aberto) {
        const marca = doc.createComment('dgui-ampliado');
        comp.parentNode.insertBefore(marca, comp);
        comp._dguiVolta = marca;
        doc.body.appendChild(comp);
        comp.classList.add('dgui-cheio');
      } else {
        comp.classList.remove('dgui-cheio');
        const marca = comp._dguiVolta;
        if (marca && marca.parentNode) { marca.parentNode.insertBefore(comp, marca); marca.remove(); }
        else comp.remove();   // a conversa se redesenhou enquanto estava aberto: a cópia nova já está lá
        comp._dguiVolta = null;
      }
      raiz.document.documentElement.classList.toggle('dgui-tem-cheio', aberto);
      btn.innerHTML = aberto ? ICO.fechar : ICO.ampliar;
      btn.title = btn.ariaLabel = aberto ? 'Fechar' : 'Ampliar';
      return;
    }
    if (!c) return;
    try {
      if (c.tipo === 'tabela') {
        if (acao === 'baixar') { baixa(new Blob([csvDe(c)], { type: 'text/csv;charset=utf-8' }), nomeArquivo(c, 'csv')); confirma(btn); }
        if (acao === 'copiar') { await raiz.navigator.clipboard.writeText(tsvDe(c)); confirma(btn); }
        return;
      }
      const png = await pngDe(c);
      if (acao === 'baixar') { baixa(png, nomeArquivo(c, 'png')); confirma(btn); return; }
      if (acao === 'compartilhar') {
        const arq = new File([png], nomeArquivo(c, 'png'), { type: 'image/png' });
        if (raiz.navigator.canShare && raiz.navigator.canShare({ files: [arq] })) {
          await raiz.navigator.share({ files: [arq], title: String(c.titulo || 'Gráfico') });
        } else if (raiz.ClipboardItem && raiz.navigator.clipboard && raiz.navigator.clipboard.write) {
          await raiz.navigator.clipboard.write([new raiz.ClipboardItem({ 'image/png': png })]);
          btn.title = 'Imagem copiada: cole onde quiser compartilhar';
          confirma(btn);
        } else { baixa(png, nomeArquivo(c, 'png')); confirma(btn); }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // a pessoa fechou o menu de compartilhar
      btn.title = 'Não deu certo: ' + (e && e.message ? e.message : 'erro');
      btn.classList.add('erro'); setTimeout(() => btn.classList.remove('erro'), 2500);
    }
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
  if (raiz.document && typeof MutationObserver === 'function') {
    let agendado = false;
    const olha = () => { if (agendado) return; agendado = true; setTimeout(() => { agendado = false; vivoProcura(); }, 120); };
    raiz.document.addEventListener('DOMContentLoaded', () => { if (raiz.document.body) new MutationObserver(olha).observe(raiz.document.body, { childList: true, subtree: true }); olha(); });
    if (raiz.document.body) new MutationObserver(olha).observe(raiz.document.body, { childList: true, subtree: true });
    setInterval(vivoProcura, 60000);
    raiz.document.addEventListener('visibilitychange', olha);
  }
  if (raiz.document) ligaCarrosseis(raiz.document);
  if (raiz.document) {
    raiz.document.addEventListener('click', (ev) => {
      if (!ev.target.closest) return;
      const th = ev.target.closest('table[data-dgui-ordena] th[data-col]');
      if (th) { ordena(th); return; }
      const dd = ev.target.closest('[data-dgui-dados]');
      if (dd) { alternaDados(dd.closest('.dgui-comp')); return; }
      const acao = ev.target.closest('[data-dgui-acao]');
      if (acao) { age(acao); return; }
      const atu = ev.target.closest('[data-dgui-vivo-atu]');
      if (atu) { vivoAtualiza(atu.dataset.dguiVivoAtu, true); return; }
      const fchip = ev.target.closest('.dgui-fchip[data-dgui-filtro]');
      if (fchip) { trocaFiltro(fchip, fchip.dataset.fv); return; }
      const leg = ev.target.closest('[data-dgui-serie]');
      if (leg) { alternaSerie(leg); return; }
      const pt = ev.target.closest('[data-dgui-ponto]');
      if (pt) { abreBalao(pt, ev); return; }
      const perg = ev.target.closest('[data-dgui-balao-pergunta]');
      if (perg) { raiz.document.dispatchEvent(new CustomEvent('dgui-pergunta', { detail: { texto: perg.dataset.dguiBalaoPergunta } })); fechaBalao(); return; }
      if (!ev.target.closest('.dgui-balao')) fechaBalao();
      const pa = ev.target.closest('[data-dgui-para-admin]');
      if (pa) {
        const caixa = pa.closest('.dgui-escolha');
        if (caixa.classList.contains('respondida')) return;
        const marca = (sim) => {
          caixa.classList.toggle('respondida', sim); pa.classList.toggle('escolhida', sim);
          try { if (sim) raiz.localStorage.setItem('dgui-escolha:' + caixa.dataset.escolha, pa.dataset.dguiParaAdmin); else raiz.localStorage.removeItem('dgui-escolha:' + caixa.dataset.escolha); } catch (_) { /* sem storage */ }
        };
        marca(true);
        const sm = pa.querySelector('small'), antes = sm.textContent;
        sm.textContent = 'Mandando…';
        // a conversa.js manda e chama feito(ok); sem envio, o botão volta
        raiz.document.dispatchEvent(new CustomEvent('dgui-para-admin', { detail: { relatorio: pa.dataset.dguiParaAdmin,
          feito: (ok) => { sm.textContent = ok ? 'Enviado. O Admin responde na conversa dele' : antes; if (!ok) marca(false); } } }));
        return;
      }
      // pergunta sugerida: a conversa (conversa.js) escuta e manda ao agente
      const op = ev.target.closest('[data-dgui-opcao]');
      if (op) {
        const caixa = op.closest('.dgui-escolha');
        if (caixa && caixa.classList.contains('respondida')) return;
        if (caixa) {
          caixa.classList.add('respondida'); op.classList.add('escolhida');
          try { raiz.localStorage.setItem('dgui-escolha:' + caixa.dataset.escolha, op.dataset.dguiOpcao); } catch (_) { /* sem storage */ }
        }
        // a pergunta do cartão vai junto: a resposta sai citando a que pergunta responde (19/10/2026)
        const perg = (caixa && caixa.querySelector('.dgui-escolha-perg')) || null;
        const car = op.closest('[data-dg-pergunta]');
        const pergunta = perg ? perg.textContent.trim() : car ? car.dataset.dgPergunta : '';
        raiz.document.dispatchEvent(new CustomEvent('dgui-pergunta', { detail: { texto: op.dataset.dguiOpcao, pergunta } }));
        return;
      }
      if (ev.target.closest('[data-dgui-outra]')) {
        const campo = raiz.document.getElementById('entrada');
        if (campo) { campo.focus(); campo.scrollIntoView({ block: 'nearest' }); }
        return;
      }
      const sug = ev.target.closest('[data-dgui-pergunta]');
      if (sug) raiz.document.dispatchEvent(new CustomEvent('dgui-pergunta', { detail: { texto: sug.dataset.dguiPergunta } }));
    });
    raiz.document.addEventListener('change', (ev) => {
      const sel = ev.target.closest && ev.target.closest('select[data-dgui-filtro]');
      if (sel) trocaFiltro(sel, sel.value);
    });
    raiz.document.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest && ev.target.closest('[data-dgui-ponto]')) { ev.preventDefault(); abreBalao(ev.target.closest('[data-dgui-ponto]'), null); return; }
      if (ev.key === 'Escape' && raiz.document.querySelector('.dgui-balao')) { fechaBalao(); return; }
      if (ev.key !== 'Escape') return;
      const aberto = raiz.document.querySelector('.dgui-comp.dgui-cheio [data-dgui-acao="ampliar"]');
      if (aberto) age(aberto);
    });
    raiz.document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const th = ev.target.closest && ev.target.closest('table[data-dgui-ordena] th[data-col]');
      if (th) { ev.preventDefault(); ordena(th); }
    });
  }

  // marca a opção já escolhida neste aparelho (depois de recarregar a página)
  function restauraEscolhas(raizEl) {
    for (const cx of (raizEl || raiz.document).querySelectorAll('.dgui-escolha:not(.respondida)')) {
      let v = null; try { v = raiz.localStorage.getItem('dgui-escolha:' + cx.dataset.escolha); } catch (_) { /* sem storage */ }
      if (!v) continue;
      cx.classList.add('respondida');
      for (const b of cx.querySelectorAll('[data-dgui-opcao]')) if (b.dataset.dguiOpcao === v) b.classList.add('escolhida');
      for (const b of cx.querySelectorAll('[data-dgui-para-admin]')) { b.classList.add('escolhida'); b.querySelector('small').textContent = 'Enviado ao Admin'; }
    }
  }
  const api = { htmlCarrossel, normaliza, restauraEscolhas, blocoParaHtml, numero, csvDe, tsvDe, pngDe, svgParaImagem, registro };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  raiz.dgui = api;
})(typeof window !== 'undefined' ? window : globalThis);
