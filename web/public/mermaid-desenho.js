/* mermaid-desenho.js (27/10/2026, pedido do dono): o bloco ```mermaid de um arquivo .md vira desenho, no
   visor da Pasta (ver-arquivo.js) e no visor de arquivos do chat (conversa.js). Chama-se depois que o
   formatador.js montou o HTML: DGMermaid.desenha(caixa, 'claro' | 'escuro'). */
(function () {
'use strict';
/* ```mermaid vira desenho. A biblioteca (5 MB) só carrega quando o arquivo tem um. O desenho vai
   numa caixa sem script nenhum (sandbox vazio, srcdoc): o texto do diagrama vem do agente, que lê o
   mundo, e esta tela tem a sessão do dono. */
let mermaidP = null;
function carregaMermaid() {
  if (!mermaidP) {
    mermaidP = new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = '/vendor/mermaid-12.1.0.min.js';
      s.onload = () => (window.mermaid ? ok(window.mermaid) : falha(new Error('a biblioteca não carregou')));
      s.onerror = () => { mermaidP = null; falha(new Error('a biblioteca não carregou')); };
      document.head.appendChild(s);
    });
  }
  return mermaidP;
}
function quadroMermaid(svg, tema) {
  const fig = document.createElement('figure');
  fig.className = 'va-mermaid';
  const vb = (/viewBox="([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(svg) || []).slice(3).map(Number);
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', '');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.title = 'Diagrama';
  // mesma color-scheme da página: sem isso o navegador pinta o fundo da caixa de branco no escuro
  f.srcdoc = `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="${tema === 'escuro' ? 'dark' : 'light'}">` +
    '<style>html,body{margin:0;background:transparent}svg{display:block;margin:0 auto;max-width:100%;height:auto}</style>' + svg;
  const corpo = document.createElement('div');
  corpo.className = 'va-mermaid-corpo';
  corpo.appendChild(f);
  fig.appendChild(corpo);
  if (vb.length === 2 && vb[0] > 0) {
    const ajusta = () => { const w = Math.min(f.clientWidth || vb[0], vb[0]); f.style.height = Math.ceil(vb[1] * w / vb[0]) + 2 + 'px'; };
    if (window.ResizeObserver) new ResizeObserver(ajusta).observe(fig);
    ajusta();
  }
  return fig;
}
/* Desenho e código no mesmo lugar (27/10/2026, pedido do dono): o desenho aparece primeiro, e um botão
   em cada barra troca para o outro. O bloco de código continua inteiro, com o Copiar. */
const ICONE_CODIGO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>';
const ICONE_DESENHO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="5" rx="1"/><rect x="14" y="15" width="7" height="5" rx="1"/><path d="M6.5 9v4.5a2 2 0 0 0 2 2H14"/></svg>';
function botao(icone, texto, aoTocar) {
  const bt = document.createElement('button');
  bt.type = 'button';
  bt.className = 'va-alterna';
  bt.title = texto;
  bt.innerHTML = icone + '<span>' + texto + '</span>';
  bt.addEventListener('click', aoTocar);
  return bt;
}
function alterna(cod, fig) {
  const barra = document.createElement('div');
  barra.className = 'cod-bar';
  barra.innerHTML = '<span class="cod-lingua">diagrama</span>';
  barra.appendChild(botao(ICONE_CODIGO, 'Ver código', () => { fig.hidden = true; cod.hidden = false; }));
  fig.prepend(barra);
  const copiar = cod.querySelector('.codcopia');
  copiar.before(botao(ICONE_DESENHO, 'Ver desenho', () => { cod.hidden = true; fig.hidden = false; }));
  cod.before(fig);
  cod.hidden = true;
}
async function desenha(caixa, tema) {
  const blocos = [...caixa.querySelectorAll('.cod')].filter(c => (c.querySelector('.cod-lingua') || {}).textContent === 'mermaid');
  if (!blocos.length) return;
  let m;
  try { m = await carregaMermaid(); } catch (_) { return; }
  m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: tema === 'escuro' ? 'dark' : 'default',
    fontFamily: getComputedStyle(document.body).fontFamily });
  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i];
    if (!b.isConnected) return;
    const id = 'dgmermaid' + Date.now() + '_' + i;
    try {
      const { svg } = await m.render(id, b.querySelector('pre').textContent);
      if (b.isConnected) alterna(b, quadroMermaid(svg, tema));
    } catch (e) {
      // diagrama com erro fica como código, com a frase do porquê
      const p = document.createElement('p');
      p.className = 'va-mermaid-erro';
      p.textContent = 'Não consegui desenhar este diagrama: ' + String((e && e.message) || e).split('\n')[0].slice(0, 160);
      b.after(p);
    } finally {
      const sobra = document.getElementById('d' + id);
      if (sobra) sobra.remove();
    }
  }
}

window.DGMermaid = { desenha };
})();
