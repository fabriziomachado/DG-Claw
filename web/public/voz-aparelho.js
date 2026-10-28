'use strict';
/* voz-aparelho.js: a voz do próprio aparelho (27/10/2026, pedido do dono). O navegador empresta as vozes
   do sistema a qualquer página: no Edge as da Microsoft (as mesmas do "Ler em voz alta"), no Chrome as do
   Google, no celular a do sistema. Grátis, sem passar pela ElevenLabs.

   A voz escolhida e a velocidade valem para este aparelho (cada aparelho tem as suas vozes) e ficam no
   localStorage. Sem escolha, vai a melhor em português do Brasil: as "naturais"/online primeiro. */
(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.DGVozAparelho = m;
})(this, function (raiz) {
  const CHAVE = 'dg-voz-aparelho';
  const sintese = () => (raiz && raiz.speechSynthesis) || null;
  let atual = null;         // a fala em curso: sem referência, o navegador pode jogá-la fora no meio (e o fim nunca chega)
  let caladoEm = 0;         // o Safari ignora uma fala pedida logo depois de um cancel
  let destravada = false;

  function prefs() {
    try { return JSON.parse(raiz.localStorage.getItem(CHAVE)) || {}; } catch (e) { return {}; }
  }
  function guarda(p) {
    try { raiz.localStorage.setItem(CHAVE, JSON.stringify(Object.assign(prefs(), p))); } catch (e) { console.warn('voz do aparelho: não guardei a escolha:', e.message); }
  }

  /* Nota de cada voz: português do Brasil antes de Portugal, natural/online antes da comum. */
  function nota(v) {
    const lang = String(v.lang || '').toLowerCase().replace('_', '-');
    let n = lang === 'pt-br' ? 100 : (lang.startsWith('pt') ? 50 : 0);
    if (/natural|online|neural/i.test(v.name)) n += 20;
    if (/google/i.test(v.name)) n += 10;
    return n;
  }
  /** Vozes em português, a melhor primeiro. Pura: recebe a lista (testável). */
  function ordena(vozes) {
    return (vozes || []).filter(v => nota(v) >= 50).sort((a, b) => nota(b) - nota(a) || a.name.localeCompare(b.name));
  }
  function lista() { const s = sintese(); return s ? ordena(s.getVoices()) : []; }
  function escolhida() {
    const l = lista(), nome = prefs().voz;
    return l.find(v => v.name === nome) || l[0] || null;
  }

  /** O Chrome carrega as vozes depois da página: avisa quando a lista chega. */
  function quandoCarregar(fn) {
    const s = sintese();
    if (!s) return;
    if (s.getVoices().length) fn();
    if (s.addEventListener) s.addEventListener('voiceschanged', fn);
  }

  /** Fala um trecho. Resolve true quando termina (ou é parado) e false se o aparelho não falou. */
  /** `aoLimite(pos, tam)`: a voz chegou na palavra que começa em `pos` do texto (onde o aparelho avisa). */
  function fala(texto, aoErro, aoLimite) {
    const s = sintese();
    if (!s || typeof raiz.SpeechSynthesisUtterance !== 'function') {
      if (aoErro) aoErro('este navegador não tem voz própria');
      return Promise.resolve(false);
    }
    return new Promise(resolve => {
      const u = new raiz.SpeechSynthesisUtterance(texto);
      const v = escolhida();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'pt-BR';
      u.rate = Number(prefs().velocidade) || 1;
      let pronto = false;
      const fim = ok => { if (!pronto) { pronto = true; if (atual === u) atual = null; resolve(ok); } };
      atual = u;
      u.onend = () => fim(true);
      if (aoLimite) u.onboundary = ev => { if (!ev || ev.name === 'word' || ev.name == null) aoLimite(ev.charIndex, ev.charLength || 0); };
      u.onerror = ev => {
        // parar ou trocar de fala também chega aqui: não é falha
        if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return fim(true);
        if (aoErro) aoErro(ev && ev.error ? ev.error : 'erro desconhecido');
        fim(false);
      };
      const espera = Math.max(0, 150 - (Date.now() - caladoEm));
      const vai = () => { if (s.paused) s.resume(); s.speak(u); };
      if (espera) setTimeout(vai, espera); else vai();
    });
  }
  // só marca a espera quando havia fala: o Testar precisa falar na hora, ainda dentro do toque
  function cala() { const s = sintese(); if (s && (s.speaking || s.pending)) { s.cancel(); caladoEm = Date.now(); } }

  /* iPhone: a página só fala depois de uma fala pedida DENTRO de um toque. No toque (touchend ou click;
     o pointerdown não conta como gesto no Safari) sai uma fala muda, e daí em diante a voz passa. */
  function destrava() {
    const s = sintese();
    if (destravada || !s || typeof raiz.SpeechSynthesisUtterance !== 'function') return;
    destravada = true;
    try {
      const u = new raiz.SpeechSynthesisUtterance('ok');
      u.volume = 0; u.rate = 2;
      s.speak(u);
    } catch (e) { console.warn('voz do aparelho: destrave falhou:', e.message); }
  }
  if (raiz && raiz.document) {
    for (const ev of ['touchend', 'click', 'keydown']) raiz.document.addEventListener(ev, destrava, { capture: true, passive: true });
  }

  return { tem: () => !!sintese(), destrava, lista, ordena, escolhida, quandoCarregar, fala, cala, prefs, guarda };
});
