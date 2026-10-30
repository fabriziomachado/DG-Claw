/* ver-arquivo.js (25/10/2026): abre um arquivo da Pasta do agente com a cara da conversa.
   ?agente=<slug>&caminho=<arquivo dentro da Pasta>. O servidor confere o caminho e registra o arquivo
   como mídia (GET /api/v1/agents/<slug>/pasta/abrir); daqui em diante é o mesmo caminho do chat:
   .html na caixa isolada do visual (sandbox só com scripts, NUNCA same-origin), texto e .md pelo
   formatador.js, o resto (imagem, PDF, planilha) direto pelo navegador.
   27/10/2026 (pedido do dono: a pasta do Tech é um wiki): tela cheia com a barra do visor do chat, link
   para outro arquivo da Pasta abre aqui mesmo (com Voltar), e ```mermaid vira desenho. */
(function () {
  'use strict';
  const raiz = document.getElementById('raiz');
  const nomeEl = document.getElementById('lbNome');
  const btFechar = document.getElementById('lbFechar');
  const btVoltar = document.getElementById('vaVoltar');
  const lnAbrir = document.getElementById('lbAbrir');
  const lnBaixar = document.getElementById('lbBaixar');
  const RX_TEXTO_LEGIVEL = /\.(md|markdown|txt|log|json|csv|tsv|ya?ml|toml|ini|env|sql|sh|bash|py|js|mjs|ts|php|css|xml)$/i;
  const TETO_TEXTO = 512 * 1024;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const aviso = msg => { raiz.innerHTML = `<p class="va-aviso">${esc(msg)}</p>`; };
  const temaApp = () => document.documentElement.dataset.tema === 'escuro' ? 'escuro' : 'claro';
  // dentro da janela do painel o X fecha a janela; sozinha numa aba, não há o que fechar nem outra aba para abrir
  const naJanela = window.parent !== window;
  const fecharJanela = () => { try { window.parent.postMessage({ dgver: 'fechar' }, location.origin); } catch (_) { /* sem janela */ } };

  const q = new URLSearchParams(location.search);
  const agente = q.get('agente') || '';
  let atual = q.get('caminho') || '';
  let vez = 0;                     // abre() mais novo vence: clique rápido em dois links não mistura as páginas

  const enderecoDe = caminho => `/ver-arquivo?agente=${encodeURIComponent(agente)}&caminho=${encodeURIComponent(caminho)}`;

  /* Caminho de um link relativo ao arquivo aberto, dentro da Pasta, ou null se sai dela. */
  function resolve(base, alvo) {
    let a = String(alvo || '').split('#')[0].split('?')[0];
    try { a = decodeURIComponent(a); } catch (_) { /* fica como veio */ }
    if (!a) return null;
    const partes = a.startsWith('/') ? [] : base.split('/').slice(0, -1);
    for (const p of a.split('/')) {
      if (p === '' || p === '.') continue;
      if (p === '..') { if (!partes.length) return null; partes.pop(); } else partes.push(p);
    }
    return partes.length ? partes.join('/') : null;
  }

  async function abre(caminho) {
    const minha = ++vez;
    atual = caminho;
    if (!agente || !caminho) return aviso('Falta dizer qual arquivo abrir.');
    nomeEl.textContent = caminho.split('/').pop();
    nomeEl.title = caminho;
    btVoltar.hidden = !(history.state && history.state.n > 0);
    lnAbrir.hidden = !naJanela;
    lnAbrir.href = enderecoDe(caminho);
    lnBaixar.hidden = true;
    let md;
    try {
      const r = await fetch(`/api/v1/agents/${encodeURIComponent(agente)}/pasta/abrir?caminho=${encodeURIComponent(caminho)}`, { credentials: 'same-origin', cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) throw new Error((j && j.erro) || `o servidor respondeu ${r.status}`);
      md = j.media;
    } catch (e) { if (minha === vez) aviso('Não consegui abrir: ' + e.message); return undefined; }
    if (minha !== vez) return undefined;
    if (!md || !md.url) return aviso('Este arquivo não pode ser aberto aqui.');
    document.title = (md.nome || 'Arquivo') + ' - S2 Bot';
    lnBaixar.href = md.url;
    lnBaixar.setAttribute('download', md.nome || '');
    lnBaixar.hidden = false;

    if (/\.html?$/i.test(md.nome || '')) {
      let v = '';
      try { v = new URL(md.url, location.href).searchParams.get('v') || ''; } catch (_) { /* sem versão */ }
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');       // NUNCA allow-same-origin (igual ao visual da conversa)
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.setAttribute('allow', '');
      f.title = md.nome || 'Página';
      f.className = 'va-vis';
      // em tela cheia ele está sempre à vista (o visual pausa animação quando não está)
      f.addEventListener('load', () => { try { f.contentWindow.postMessage({ dgvis: 1, tipo: 'visivel', v: true }, '*'); } catch (_) { /* fechou */ } });
      f.src = '/api/v1/media/' + encodeURIComponent(md.id) + '/visual?tema=' + temaApp() + (v ? '&v=' + encodeURIComponent(v) : '');
      raiz.innerHTML = '';
      raiz.appendChild(f);
      return undefined;
    }
    if (RX_TEXTO_LEGIVEL.test(md.nome || '') && (!md.bytes || md.bytes <= TETO_TEXTO)) {
      try {
        const r = await fetch(md.url, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('o servidor respondeu ' + r.status);
        const t = (await r.text()).slice(0, TETO_TEXTO);
        if (minha !== vez) return undefined;
        raiz.innerHTML = '<div class="lb-texto">' + window.DGFormatador.arquivoParaHtml(t, md.nome, { pasta: true }) + '</div>';
        raiz.firstChild.scrollTop = 0;
        window.DGMermaid.desenha(raiz.firstChild, temaApp());
      } catch (e) { aviso('Não consegui ler o arquivo: ' + e.message); }
      return undefined;
    }
    if (md.kind === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(md.nome || '')) {
      raiz.innerHTML = `<img src="${esc(md.url)}" alt="${esc(md.nome || '')}">`;
      return undefined;
    }
    // PDF, planilha e o resto: o navegador decide (o Voltar do navegador traz de volta)
    location.assign(md.url);
    return undefined;
  }

  const vai = destino => {
    const n = ((history.state && history.state.n) || 0) + 1;
    history.pushState({ caminho: destino, n }, '', enderecoDe(destino));
    abre(destino);
  };
  /* Imagem de carrossel ou de figura dentro do documento (30/10/2026, pedido do dono): no chat o toque
     amplia; aqui abre a imagem inteira no próprio visor, e o Voltar traz o documento. Só imagem da
     Pasta deste mesmo agente (/api/v1/agents/<agente>/pasta/imagem?caminho=...). */
  function caminhoDaImagem(img) {
    let u;
    try { u = new URL(img.getAttribute('src') || '', location.origin); } catch (_) { return null; }
    if (u.origin !== location.origin || u.pathname !== `/api/v1/agents/${encodeURIComponent(agente)}/pasta/imagem`) return null;
    return resolve('', '/' + (u.searchParams.get('caminho') || ''));
  }

  raiz.addEventListener('click', ev => {
    // link para outro arquivo da Pasta: abre aqui, e o Voltar (da barra ou do navegador) volta
    const ln = ev.target.closest ? ev.target.closest('.lnk-pasta') : null;
    if (ln) {
      ev.preventDefault();
      const destino = resolve(atual, ln.getAttribute('data-pasta'));
      if (!destino) return aviso('Este link aponta para fora da Pasta do agente e não abre aqui.');
      vai(destino);
      return;
    }
    const img = ev.target.closest ? ev.target.closest('.dg-car-img, .dgui-imagem img') : null;
    const daImagem = img && caminhoDaImagem(img);
    if (daImagem) { ev.preventDefault(); vai(daImagem); return; }
    // o Copiar dos blocos de código, igual ao da conversa
    const bt = ev.target.closest ? ev.target.closest('.codcopia') : null;
    const pre = bt && bt.closest('.cod') && bt.closest('.cod').querySelector('pre');
    if (!pre || !navigator.clipboard) return;
    navigator.clipboard.writeText(pre.textContent).then(() => {
      const tx = bt.querySelector('span');
      bt.classList.add('ok'); if (tx) tx.textContent = 'Copiado';
      setTimeout(() => { bt.classList.remove('ok'); if (tx) tx.textContent = 'Copiar'; }, 1600);
    }, () => {});
  });

  window.addEventListener('popstate', ev => abre((ev.state && ev.state.caminho) || q.get('caminho') || ''));
  btVoltar.addEventListener('click', () => history.back());
  btFechar.hidden = !naJanela;
  btFechar.addEventListener('click', fecharJanela);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && naJanela) fecharJanela(); });
  // trocou o tema: a página e os diagramas se redesenham com as cores novas
  document.addEventListener('dgtema', () => {
    const f = raiz.querySelector('.va-vis');
    if (f) { try { f.contentWindow.postMessage({ dgvis: 1, tipo: 'tema', valor: temaApp() }, '*'); } catch (_) { /* visual fechado */ } return; }
    if (raiz.querySelector('.va-mermaid')) abre(atual);
  });

  history.replaceState({ caminho: atual, n: (history.state && history.state.n) || 0 }, '', location.href);
  abre(atual);
})();
