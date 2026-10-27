/* formatador.js (25/10/2026): o formatador das mensagens, tirado do conversa.js sem reescrever, para a
   Pasta do agente (painel) abrir os arquivos com a MESMA cara da conversa (pedido do dono: "igual de
   verdade"). Um só para as duas telas: o que mudar aqui muda nas duas. Estilo em formatador.css.
   Usa window.hljs (vendor/highlight) quando carregado, window.dgui e window.campoCofre se existirem. */
(function () {
'use strict';
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Link na mensagem. O ponto, a vírgula ou o parêntese que fecham a frase não
   são do endereço: antes entravam no link e ele abria quebrado ("...mc83T.").
   Parêntese só fica se abriu dentro da própria URL (Wikipédia). Roda sobre
   texto já escapado, por isso o &quot; é tratado como uma aspa só. */
// a crase não entra (26/10/2026): `https://...` levava a crase de fechar e o resto da mensagem virava código
const linkify = s => s.replace(/https?:\/\/[^\s<`]+/g, url => {
  let fim = '';
  for (;;) {
    if (url.endsWith('&quot;')) { fim = '&quot;' + fim; url = url.slice(0, -6); continue; }
    const c = url.slice(-1);
    if (!/[.,;:!?'\])}*_]/.test(c)) break;
    if (c === ')' && url.split('(').length > url.split(')').length - 1) break;
    fim = c + fim;
    url = url.slice(0, -1);
  }
  if (/^https?:\/\/$/.test(url)) return url + fim;
  return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${fim}`;
});

/* Formatação em texto simples: **x** vira negrito, e o formato markdownv2 usa *x*, _x_ e
   `x`.
   Tudo é escapado ANTES: o que vira tag aqui é só o que eu mesmo escrevo.
   O `código` vale em qualquer formato. */
function formata(htmlSeguro, fmt) {
  let s = htmlSeguro.replace(/\*\*([^*\n][^*]*?)\*\*/g, '<b>$1</b>')
    // [texto](url): o linkify já fez o <a> da url, aqui ele ganha o texto
    .replace(/\[([^\]\n]+)\]\((<a href="([^"]+)"[^>]*>[^<]*<\/a>)\)/g,
             '<a href="$3" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
  if (fmt === 'markdownv2') {
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<b>$2</b>')
         .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
         .replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1');
  }
  return s;
}

/* ```diff (18/10/2026, pedido do dono): o que mudou num código, linha a linha, como no GitHub.
   Vale para ```diff e ```patch, e para bloco sem língua que tem cara de diff (@@ ou ---/+++).
   Cada linha vira um <span> com o \n dentro: o copiar (pre.textContent) devolve o texto igual. */
function ehDiff(lingua, cod) {
  if (lingua === 'diff' || lingua === 'patch') return true;
  if (lingua) return false;
  const l = cod.split('\n');
  return l.some(x => /^@@ .* @@/.test(x)) || (l.some(x => x.startsWith('--- ')) && l.some(x => x.startsWith('+++ ')));
}
/* Cores de sintaxe (18/10/2026, pedido do dono): bloco com a língua no cabeçalho (```php, ```bash...)
   passa pelo highlight.js (vendor/, sem rede), que já devolve o texto escapado. Sem língua ou com
   língua que ele não conhece, fica o texto puro. O render redesenha a conversa toda hora: guarda. */
const SINTAXE_NOME = { bash: 'Bash', sh: 'Shell', shell: 'Shell', zsh: 'Shell', js: 'JavaScript', javascript: 'JavaScript',
  ts: 'TypeScript', typescript: 'TypeScript', py: 'Python', python: 'Python', php: 'PHP', sql: 'SQL', json: 'JSON',
  yaml: 'YAML', yml: 'YAML', html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS', go: 'Go', rust: 'Rust', java: 'Java',
  kotlin: 'Kotlin', csharp: 'C#', cs: 'C#', cpp: 'C++', c: 'C', ruby: 'Ruby', rb: 'Ruby', ini: 'INI', toml: 'TOML',
  markdown: 'Markdown', md: 'Markdown', dockerfile: 'Dockerfile', nginx: 'Nginx', graphql: 'GraphQL', lua: 'Lua', r: 'R', swift: 'Swift' };
const sintaxeCache = new Map();
function htmlSintaxe(lingua, cod) {
  const h = window.hljs;
  const l = lingua === 'toml' ? 'ini' : lingua === 'zsh' ? 'bash' : lingua;
  if (!h || !l || !h.getLanguage(l)) return null;
  const k = l + '\u0000' + cod;
  if (sintaxeCache.has(k)) return sintaxeCache.get(k);
  let v = null;
  try { v = h.highlight(cod, { language: l, ignoreIllegals: true }).value; } catch (_) { v = null; }
  if (sintaxeCache.size > 200) sintaxeCache.clear();
  sintaxeCache.set(k, v);
  return v;
}
function htmlDiff(cod) {
  return cod.split('\n').map(x => {
    const c = /^(\+\+\+ |--- |diff --git|index )/.test(x) ? 'd-meta' : x.startsWith('@@') ? 'd-hunk'
      : x.startsWith('+') ? 'd-add' : x.startsWith('-') ? 'd-del' : 'd-ctx';
    return `<span class="${c}">${esc(x)}\n</span>`;
  }).join('');
}
const ICONE_COPIAR = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
  '<rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" ' +
  'stroke="currentColor" stroke-width="2"/></svg>';

function textoEmParagrafos(txt, fmt) {
  return txt.split(/\n[ \t]*\n+/).filter(p => p.trim() !== '')
    .map(p => paragrafoComTabelas(p.trim(), fmt)).join('');
}

/* Tabela em Markdown (| a | b | com a linha |---|) vira tabela de verdade (18/10/2026): os
   agentes respondem dados assim e a linha crua cheia de barras era ilegível. O texto do
   parágrafo antes e depois da tabela continua como parágrafo. Cada célula passa pelo mesmo
   esc + linkify + formata do resto, então negrito e link funcionam dentro dela. */
const RX_LINHA_TAB = /^\s*\|.*\|\s*$/;
const RX_SEP_TAB = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
function celulasTab(linha) {
  return linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}
function htmlTabela(linhas, fmt) {
  const cab = celulasTab(linhas[0]);
  const alin = celulasTab(linhas[1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : '');
  const corpo = linhas.slice(2).map(celulasTab);
  const cel = c => formata(linkify(esc(c)), fmt);
  // coluna só de números (1.234, 7,5%, R$ 10) alinha à direita, como planilha
  const numerica = cab.map((_, i) => corpo.length > 0 && corpo.every(r => /^[\s*_]*[-+]?(R\$\s*)?[\d.,]+\s*%?[\s*_]*$/.test(r[i] || '')));
  const st = i => { const a = alin[i] || (numerica[i] ? 'right' : ''); return a ? ` style="text-align:${a}"` : ''; };
  return '<div class="tabela-md"><table><thead><tr>' + cab.map((c, i) => `<th${st(i)}>${cel(c)}</th>`).join('') +
         '</tr></thead><tbody>' + corpo.map(r => '<tr>' + cab.map((_, i) => `<td${st(i)}>${cel(r[i] || '')}</td>`).join('') + '</tr>').join('') +
         '</tbody></table></div>';
}
function paragrafoComTabelas(p, fmt) {
  const linhas = p.split('\n');
  let html = '', texto = [];
  const soltaTexto = () => { if (texto.length) html += `<div class="p">${formata(linkify(esc(texto.join('\n').trim())), fmt)}</div>`; texto = []; };
  for (let i = 0; i < linhas.length; i++) {
    if (RX_LINHA_TAB.test(linhas[i]) && i + 1 < linhas.length && RX_SEP_TAB.test(linhas[i + 1])) {
      let j = i + 2;
      while (j < linhas.length && RX_LINHA_TAB.test(linhas[j])) j++;
      soltaTexto();
      html += htmlTabela(linhas.slice(i, j), fmt);
      i = j - 1;
    } else {
      texto.push(linhas[i]);
    }
  }
  soltaTexto();
  return html;
}

/* ```bloco``` vira a "caixa de texto" com fundo mais escuro e o botão de
   copiar: o agente põe ali o texto pronto pra colar em outro
   lugar, e um toque copia só ele, sem a introdução. Separado ANTES dos
   parágrafos, porque bloco com linha em branco no meio se partia em dois. */
function paragrafos(txt, fmt) {
  const partes = String(txt).split('```');
  let html = '';
  for (let i = 0; i < partes.length; i++) {
    const fechado = i % 2 === 1 && i < partes.length - 1;
    if (!fechado) {
      // ``` sem par fica como texto, com as crases
      const t = i % 2 === 1 ? '```' + partes[i] : partes[i];
      html += textoEmParagrafos(t, fmt);
      continue;
    }
    // ```dgcofre: campo de senha (campo-cofre.js); nome inválido cai no bloco normal
    const cofre = window.campoCofre && window.campoCofre.blocoParaHtml(partes[i], txt);
    if (cofre) { html += cofre; continue; }
    // ```dgui: KPI, tabela e gráfico desenhados pela tela (dgui.js)
    const ui = window.dgui && window.dgui.blocoParaHtml(partes[i]);
    if (ui) { html += ui; continue; }
    const lingua = ((/^([A-Za-z0-9_+.-]{1,20})\n/.exec(partes[i]) || [])[1] || '').toLowerCase();
    let cod = partes[i].replace(/^[A-Za-z0-9_+.-]{1,20}\n/, '')
                         .replace(/^\n+/, '').replace(/\s+$/, '');
    // no MarkdownV2, dentro do bloco só a crase e a barra vêm escapadas
    if (fmt === 'markdownv2') cod = cod.replace(/\\([`\\])/g, '$1');
    if (!cod) continue;
    const diff = ehDiff(lingua, cod);
    const cor = diff ? null : htmlSintaxe(lingua, cod);
    // bloco de código com cara de código-fonte (19/10/2026): barra no topo com a língua e o Copiar
    const nomeLingua = diff ? 'diff' : lingua && lingua !== 'text' && lingua !== 'plaintext' ? (SINTAXE_NOME[lingua] || lingua) : 'texto';
    html += `<div class="cod${diff ? ' cod-diff' : ''}"><div class="cod-bar"><span class="cod-lingua">${esc(nomeLingua)}</span>` +
            `<button type="button" class="codcopia" aria-label="Copiar o código" title="Copiar o código">${ICONE_COPIAR}<span>Copiar</span></button></div>` +
            `<pre${cor != null ? ' class="hljs"' : ''}>${diff ? htmlDiff(cod) : (cor != null ? cor : esc(cod))}</pre></div>`;
  }
  return html;
}

/* No visor, o .md vira documento: títulos (# a ###), listas, citação (>) e linha (---), que a
   conversa não usa. Parágrafos e tabelas seguem o mesmo paragrafos() das mensagens, e cada
   linha passa pelo mesmo esc + linkify + formata, então negrito, `código` e link funcionam. */
function mdComTitulos(t) {
  const linha = x => formata(linkify(esc(x)), 'markdown');
  const blocoTexto = linhas => {
    let html = '', resto = [], i = 0;
    const solta = () => { const r = resto.join('\n'); if (r.trim()) html += paragrafos(r, 'markdown'); resto = []; };
    while (i < linhas.length) {
      const l = linhas[i];
      let m;
      if ((m = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/.exec(l))) {
        solta(); const n = Math.min(m[1].length, 3) + 1;
        html += `<h${n} class="lb-tit">${linha(m[2])}</h${n}>`; i++;
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
        solta(); html += '<hr class="lb-hr">'; i++;
      } else if (/^\s*>/.test(l)) {
        solta(); const q = [];
        while (i < linhas.length && /^\s*>/.test(linhas[i])) q.push(linhas[i++].replace(/^\s*>\s?/, ''));
        html += `<blockquote class="lb-cita">${blocoTexto(q)}</blockquote>`;
      } else if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
        solta(); const ord = /^\s*\d/.test(l), itens = [];
        while (i < linhas.length && (/^\s*([-*+]|\d+[.)])\s+/.test(linhas[i]) || (/^\s{2,}\S/.test(linhas[i]) && itens.length))) {
          const x = linhas[i++];
          if (/^\s*([-*+]|\d+[.)])\s+/.test(x)) itens.push(x.replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
          else itens[itens.length - 1] += ' ' + x.trim();
        }
        const tag = ord ? 'ol' : 'ul';
        html += `<${tag} class="lb-lista">${itens.map(x => `<li>${linha(x)}</li>`).join('')}</${tag}>`;
      } else { resto.push(l); i++; }
    }
    solta();
    return html;
  };
  return String(t).split(/(```[\s\S]*?```)/).map((p, i) => i % 2 ? paragrafos(p, 'markdown') : blocoTexto(p.split('\n'))).join('');
}

/* Arquivo inteiro para o visor: .md vira documento; o resto vira bloco de código com a língua. */
const LINGUA_DA_EXT = { txt: 'text', log: 'text', csv: 'text', tsv: 'text', env: 'ini', yml: 'yaml', htm: 'html', mjs: 'javascript', js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash' };
function arquivoParaHtml(texto, nome) {
  const ext = ((/\.([a-z0-9]+)$/i.exec(nome || '') || [])[1] || '').toLowerCase();
  if (ext === 'md' || ext === 'markdown') return `<div class="lb-md">${mdComTitulos(texto)}</div>`;
  const lingua = LINGUA_DA_EXT[ext] || ext;
  return `<div class="lb-md">${paragrafos('```' + lingua + '\n' + String(texto).replace(/```/g, 'ˋˋˋ') + '\n```', 'markdown')}</div>`;
}

window.DGFormatador = { esc, linkify, formata, ehDiff, SINTAXE_NOME, htmlSintaxe, htmlDiff, ICONE_COPIAR, textoEmParagrafos,
  RX_LINHA_TAB, htmlTabela, paragrafos, mdComTitulos, arquivoParaHtml, LINGUA_DA_EXT };
})();
