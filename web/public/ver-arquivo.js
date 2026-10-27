/* ver-arquivo.js (25/10/2026): abre um arquivo da Pasta do agente com a cara da conversa.
   ?agente=<slug>&caminho=<arquivo dentro da Pasta>. O servidor confere o caminho e registra o arquivo
   como mídia (GET /api/v1/agents/<slug>/pasta/abrir); daqui em diante é o mesmo caminho do chat:
   .html na caixa isolada do visual (sandbox só com scripts, NUNCA same-origin), texto e .md pelo
   formatador.js, o resto (imagem, PDF, planilha) direto pelo navegador. */
(function () {
  'use strict';
  const raiz = document.getElementById('raiz');
  const RX_TEXTO_LEGIVEL = /\.(md|markdown|txt|log|json|csv|tsv|ya?ml|toml|ini|env|sql|sh|bash|py|js|mjs|ts|php|css|xml)$/i;
  const TETO_TEXTO = 512 * 1024;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const aviso = msg => { raiz.innerHTML = `<p class="va-aviso">${esc(msg)}</p>`; };
  const temaApp = () => document.documentElement.dataset.tema === 'escuro' ? 'escuro' : 'claro';

  async function abre() {
    const q = new URLSearchParams(location.search);
    const agente = q.get('agente') || '', caminho = q.get('caminho') || '';
    if (!agente || !caminho) return aviso('Falta dizer qual arquivo abrir.');
    let md;
    try {
      const r = await fetch(`/api/v1/agents/${encodeURIComponent(agente)}/pasta/abrir?caminho=${encodeURIComponent(caminho)}`, { credentials: 'same-origin', cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) throw new Error((j && j.erro) || `o servidor respondeu ${r.status}`);
      md = j.media;
    } catch (e) { return aviso('Não consegui abrir: ' + e.message); }
    if (!md || !md.url) return aviso('Este arquivo não pode ser aberto aqui.');
    document.title = (md.nome || 'Arquivo') + ' - S2 Bot';

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
      document.addEventListener('dgtema', () => { try { f.contentWindow.postMessage({ dgvis: 1, tipo: 'tema', valor: temaApp() }, '*'); } catch (_) { /* visual fechado */ } });
      return undefined;
    }
    if (RX_TEXTO_LEGIVEL.test(md.nome || '') && (!md.bytes || md.bytes <= TETO_TEXTO)) {
      try {
        const r = await fetch(md.url, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('o servidor respondeu ' + r.status);
        const t = (await r.text()).slice(0, TETO_TEXTO);
        raiz.innerHTML = '<div class="lb-texto">' + window.DGFormatador.arquivoParaHtml(t, md.nome) + '</div>';
      } catch (e) { aviso('Não consegui ler o arquivo: ' + e.message); }
      return undefined;
    }
    location.replace(md.url);
    return undefined;
  }

  // o Copiar dos blocos de código, igual ao da conversa
  raiz.addEventListener('click', ev => {
    const bt = ev.target.closest ? ev.target.closest('.codcopia') : null;
    const pre = bt && bt.closest('.cod') && bt.closest('.cod').querySelector('pre');
    if (!pre || !navigator.clipboard) return;
    navigator.clipboard.writeText(pre.textContent).then(() => {
      const tx = bt.querySelector('span');
      bt.classList.add('ok'); if (tx) tx.textContent = 'Copiado';
      setTimeout(() => { bt.classList.remove('ok'); if (tx) tx.textContent = 'Copiar'; }, 1600);
    }, () => {});
  });

  abre();
})();
