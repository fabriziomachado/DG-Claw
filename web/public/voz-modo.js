'use strict';
/* voz-modo.js: conversa por voz no estilo do ChatGPT (26/10/2026, pedido do dono).

   A onda azul ao lado do microfone (com o campo vazio) abre a tela de voz: a pessoa fala, o
   silêncio de 1,4 s manda sozinho, o agente responde em voz e o microfone abre de novo. Fica
   por cima do conversa.js sem mexer na lógica dele: pela ponte window.DGConversaVoz usa a
   gravação, a transcrição, a fila de leitura e a conversa contínua que já existem, e só lê o
   estado (gravando, esperando, falando...). O que é novo aqui: o botão, a tela com a linha de
   onda e a escuta do silêncio. */
(function () {
  if (window.DGConversaVoz) iniciaModoVoz(window.DGConversaVoz);
  else document.addEventListener('dgconversa-voz', () => iniciaModoVoz(window.DGConversaVoz), { once: true });
})();

function iniciaModoVoz(V) {
  if (!V || typeof V.comecaGravar !== 'function') {
    console.warn('voz-modo: a ponte da conversa não veio; o modo de voz fica desligado.');
    return;
  }
  const { comecaGravar, paraEEnvia, cancelaGravacao, cancelaFala } = V;
  const linha1 = document.querySelector('.barra .linha1');
  const barra = document.querySelector('.barra');
  if (!linha1 || !barra) return;

  const svg = (d, t, sw) => '<svg viewBox="0 0 24 24" width="' + t + '" height="' + t + '" fill="none" stroke="currentColor" ' +
    'stroke-width="' + (sw || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICO = {
    onda: svg('<path d="M5 10v4M9 7v10M13 4v16M17 8v8M21 11v2"/>', 20, 2.2),
    mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>', 22),
    micMudo: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16"/>', 22),
    fechar: svg('<path d="M6 6l12 12M18 6 6 18"/>', 22),
  };

  /* Silêncio: nível (RMS x4, a mesma escala da onda do ditado) abaixo do limiar por 1,4 s,
     depois de pelo menos 0,25 s de fala. Sem fala em 45 s, recomeça a gravação (não junta
     minutos de silêncio num áudio só). Fala acima de 90 s manda do jeito que está. */
  const SILENCIO_MS = 1400, FALA_MIN_MS = 250, SEM_FALA_MS = 45000, FALA_MAX_MS = 90000;
  const LIMIAR_MIN = 0.07;

  const btnVoz = document.createElement('button');
  btnVoz.id = 'btnVoz';
  btnVoz.type = 'button';
  btnVoz.title = 'Conversar por voz';
  btnVoz.setAttribute('aria-label', 'Conversar por voz');
  btnVoz.innerHTML = ICO.onda;
  const btnEnviarEl = document.getElementById('btnEnviar');
  if (btnEnviarEl) btnEnviarEl.before(btnVoz); else linha1.appendChild(btnVoz);

  const palco = document.createElement('div');
  palco.className = 'vm-palco';
  palco.hidden = true;
  palco.setAttribute('role', 'region');
  palco.setAttribute('aria-label', 'Conversa por voz');
  palco.innerHTML =
    '<button type="button" class="vm-onda" aria-label="Onda da conversa por voz">' +
      '<canvas aria-hidden="true"></canvas><span class="vm-pts" aria-hidden="true"><i></i><i></i><i></i></span></button>' +
    '<div class="vm-estado" aria-live="polite"></div><div class="vm-sub"></div>' +
    '<div class="vm-ctrl"><button type="button" class="vm-mic"></button>' +
    '<button type="button" class="vm-fim" title="Encerrar a conversa por voz" aria-label="Encerrar a conversa por voz">' + ICO.fechar + '</button></div>';
  barra.prepend(palco);
  const ondaBtn = palco.querySelector('.vm-onda');
  const tela = palco.querySelector('canvas');
  const estadoTxt = palco.querySelector('.vm-estado');
  const subTxt = palco.querySelector('.vm-sub');
  const micBtn = palco.querySelector('.vm-mic');
  const fimBtn = palco.querySelector('.vm-fim');

  let ativo = false, mudo = false, lerAntes = false;
  let tick = null, raf = 0;
  let escuta = null;          // { stream, fonte, an, buf, ctx, proprio, inicio, falaMs, ultimaFala, piso }
  let niveis = [];            // histórico da linha de onda (o mais novo à direita)
  let estado = '', paradoDesde = 0;

  const nome = () => (V.agente && V.agente.nome) || 'O agente';
  const dormir = ms => new Promise(r => setTimeout(r, ms));

  /* ── O estado da tela sai do estado do conversa.js ── */
  function estadoAgora() {
    const e = V.estado();
    if (mudo) return 'mudo';
    if (e.gravando) return e.micAbrindo ? 'abrindo' : 'ouvindo';
    if (e.pedindoMic) return 'abrindo';
    if (e.falando) return 'falando';
    if (e.transcrevendo || e.esperando || e.fila || e.trabalhando) return 'pensando';
    return 'parado';
  }
  const ocupado = () => { const e = V.estado(); return e.gravando || e.pedindoMic || !!e.stream; };
  const TEXTOS = {
    abrindo: () => ['Abrindo o microfone', ''],
    ouvindo: () => ['Ouvindo', 'envia sozinho quando você parar de falar'],
    pensando: () => [nome() + ' está pensando', ''],
    falando: () => [nome() + ' está falando', 'toque na onda para interromper'],
    mudo: () => ['Microfone silenciado', 'toque no microfone para voltar a falar'],
    parado: () => ['Toque na onda para falar', ''],
  };

  function pinta() {
    let e = estadoAgora();
    // entre a transcrição e o envio há um instante sem nada: não pisca "parado"
    if (e === 'parado') {
      if (!paradoDesde) paradoDesde = Date.now();
      if (Date.now() - paradoDesde < 1500 && estado && estado !== 'parado') e = estado;
    } else paradoDesde = 0;
    if (e === estado) return;
    estado = e;
    palco.dataset.estado = e;
    const [t, s] = TEXTOS[e]();
    estadoTxt.textContent = t;
    subTxt.textContent = s;
    micBtn.innerHTML = mudo ? ICO.micMudo : ICO.mic;
    micBtn.classList.toggle('on', mudo);
    micBtn.title = mudo ? 'Voltar a falar' : 'Silenciar o microfone';
    micBtn.setAttribute('aria-label', micBtn.title);
  }

  /* ── Escuta do silêncio (só lê o mesmo microfone da gravação; não grava nada) ── */
  function escutaLiga(stream) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const compartilhado = V.audio();
      const proprio = !compartilhado;
      const ctx = compartilhado || new AC();
      if (ctx.state === 'suspended') ctx.resume();
      const fonte = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      fonte.connect(an);
      escuta = { stream, fonte, an, ctx, proprio, buf: new Uint8Array(an.fftSize),
                 inicio: Date.now(), falaMs: 0, ultimaFala: 0, piso: 0.02, ultimo: Date.now(), mandou: false };
    } catch (e) {
      console.warn('voz-modo: não consegui escutar o microfone (o envio fica no toque):', e.message);
      escuta = null;
    }
  }
  function escutaDesliga() {
    if (!escuta) return;
    try { escuta.fonte.disconnect(); } catch (e) { /* já solto */ }
    if (escuta.proprio) { try { escuta.ctx.close(); } catch (e) { /* já fechado */ } }
    escuta = null;
  }
  function nivelDoMic() {
    escuta.an.getByteTimeDomainData(escuta.buf);
    let soma = 0;
    for (const v of escuta.buf) { const d = (v - 128) / 128; soma += d * d; }
    return Math.min(1, Math.sqrt(soma / escuta.buf.length) * 4);
  }
  function confereSilencio() {
    const e = V.estado();
    if (!(e.gravando && !e.micAbrindo && e.stream)) { if (escuta) escutaDesliga(); return; }
    if (!escuta || escuta.stream !== e.stream) { escutaDesliga(); escutaLiga(e.stream); if (!escuta) return; }
    const agora = Date.now(), passo = agora - escuta.ultimo;
    escuta.ultimo = agora;
    const v = nivelDoMic();
    niveis.push(v);
    if (niveis.length > 400) niveis.shift();
    const limiar = Math.max(LIMIAR_MIN, escuta.piso * 2.5);
    if (v > limiar) { escuta.falaMs += passo; escuta.ultimaFala = agora; }
    else escuta.piso = escuta.piso * 0.95 + v * 0.05;   // o ruído do ambiente sobe o limiar devagar
    if (escuta.mandou) return;
    const falou = escuta.falaMs >= FALA_MIN_MS;
    if ((falou && agora - escuta.ultimaFala >= SILENCIO_MS) || (falou && agora - escuta.inicio >= FALA_MAX_MS)) {
      escuta.mandou = true;
      paraEEnvia(true);
    } else if (!falou && agora - escuta.inicio >= SEM_FALA_MS) {
      escuta.mandou = true;
      recomeca();
    }
  }
  async function recomeca() {
    await cancelaGravacao();
    if (ativo && !mudo) comecaGravar();
  }

  /* ── Linha de onda: pontinhos, o mais novo à direita (igual ao ditado) ── */
  function desenha(t) {
    raf = requestAnimationFrame(desenha);
    const dpr = window.devicePixelRatio || 1;
    const w = tela.clientWidth, h = tela.clientHeight;
    if (!w || !h) return;
    if (tela.width !== Math.round(w * dpr)) { tela.width = Math.round(w * dpr); tela.height = Math.round(h * dpr); }
    const c = tela.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const css = getComputedStyle(palco);
    const forte = css.getPropertyValue('--vm-forte').trim() || '#5d5d5d';
    const fraco = css.getPropertyValue('--vm-fraco').trim() || '#e5e5e5';
    const esp = 6, n = Math.floor(w / esp), meio = h / 2;
    for (let i = 0; i < n; i++) {
      let v;
      if (estado === 'falando') {
        // onda calma, só para mostrar que é a vez dele (o som não passa por aqui)
        const k = i / n;
        v = 0.08 + 0.32 * Math.abs(Math.sin(t / 380 + i * 0.45)) * Math.sin(Math.PI * k) * (0.6 + 0.4 * Math.sin(t / 900 + i));
      } else v = estado === 'ouvindo' ? (niveis[niveis.length - n + i] || 0) : 0;
      const alt = Math.max(3, v * (h - 4));
      c.fillStyle = v > 0.04 ? forte : fraco;
      const x = w - (n - i) * esp + 1.5;
      c.beginPath();
      if (c.roundRect) c.roundRect(x, meio - alt / 2, 3, alt, 1.5); else c.rect(x, meio - alt / 2, 3, alt);
      c.fill();
    }
  }

  /* ── Abrir, silenciar e encerrar ── */
  /* continuar: veio de outro agente com o modo ligado. Sem um toque nesta página o navegador pode
     barrar o som, então aí a tela abre parada ("Toque na onda para falar") e o toque libera tudo. */
  /* silenciado: veio de outro agente com o microfone silenciado, e continua assim (28/10/2026). */
  function abre(continuar, silenciado) {
    if (ativo) return;
    V.destravarAudio();
    if (!V.caps.microfone || !V.caps.voz) return;
    ativo = true; mudo = silenciado === true; estado = ''; niveis = [];
    lerAntes = V.ler;
    V.ler = true;
    V.continua = !mudo;
    document.documentElement.classList.add('modo-voz');
    palco.hidden = false;
    pinta();
    tick = setInterval(() => { confereSilencio(); pinta(); }, 50);
    raf = requestAnimationFrame(desenha);
    const semToque = continuar === true && navigator.userActivation && !navigator.userActivation.hasBeenActive;
    if (!mudo && !semToque && !ocupado() && !V.estado().transcrevendo) comecaGravar();
  }

  async function encerra() {
    if (!ativo) return;
    ativo = false; mudo = false;
    clearInterval(tick); tick = null;
    cancelAnimationFrame(raf); raf = 0;
    escutaDesliga();
    V.continua = false;
    const e = V.estado();
    if (e.falando || e.fila) cancelaFala();
    V.ler = lerAntes;
    palco.hidden = true;
    document.documentElement.classList.remove('modo-voz');
    if (ocupado()) await cancelaGravacao();
  }

  async function alternaMudo() {
    if (!ativo) return;
    mudo = !mudo;
    V.continua = !mudo;    // silenciado, o fim da resposta não reabre o microfone
    pinta();
    if (mudo) { escutaDesliga(); if (ocupado()) await cancelaGravacao(); }
    else if (!ocupado() && !V.estado().falando) comecaGravar();
  }

  async function toqueNaOnda() {
    if (!ativo) return;
    if (mudo) return alternaMudo();
    if (estado === 'falando') {
      cancelaFala();          // interrompe e já é a vez da pessoa
      await dormir(120);
      if (ativo && !ocupado()) comecaGravar();
    } else if (estado === 'ouvindo') {
      if (escuta) escuta.mandou = true;
      paraEEnvia(true);       // terminou antes do silêncio: manda já
    } else if (estado === 'parado') comecaGravar();
  }

  btnVoz.onclick = () => abre();
  fimBtn.onclick = encerra;
  micBtn.onclick = alternaMudo;
  ondaBtn.onclick = toqueNaOnda;
  document.addEventListener('keydown', ev => { if (ativo && ev.key === 'Escape') { ev.preventDefault(); encerra(); } });
  // sair da tela (trocar de agente, fechar) solta o microfone. Trocar de agente com o modo ligado
  // reabre o modo no agente novo (27/10/2026, pedido do dono): a marca vale 30 s, só nesta aba. O microfone
  // silenciado vai junto: antes ele voltava ligado sozinho no agente novo e na volta (28/10/2026).
  const CHAVE_MODO = 'dg-modo-voz';
  window.addEventListener('pagehide', () => {
    if (!ativo) return;
    try { sessionStorage.setItem(CHAVE_MODO, JSON.stringify({ em: Date.now(), mudo })); } catch (e) { /* sem armazenamento: só não reabre */ }
    encerra();
  });
  let marca = null;
  try { marca = JSON.parse(sessionStorage.getItem(CHAVE_MODO) || 'null'); sessionStorage.removeItem(CHAVE_MODO); } catch (e) { /* idem */ }
  if (typeof marca === 'number') marca = { em: marca, mudo: false };   // marca antiga, de antes desta versão
  if (marca && Date.now() - marca.em < 30000) abre(true, marca.mudo === true);

  window.DGModoVoz = { abre, encerra, ativo: () => ativo, estado: () => estado };
}
