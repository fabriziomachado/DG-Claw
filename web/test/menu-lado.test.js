'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../public/menu-lado');

const pub = (n) => fs.readFileSync(path.join(__dirname, '../public', n), 'utf8');

test('conversa.html carrega o menu novo e não tem mais o link avulso do painel', () => {
  const h = pub('conversa.html');
  assert.match(h, /<link rel="stylesheet" href="\/menu-lado\.css">/);
  assert.match(h, /<script src="\/menu-lado\.js"><\/script>/);
  assert.ok(h.indexOf('/menu-lado.js') < h.indexOf('/conversa.js'), 'menu-lado.js precisa vir antes do conversa.js');
  assert.doesNotMatch(h, /gmSecPainel/);
});

test('sw.js guarda os arquivos novos e está na v14', () => {
  const s = pub('sw.js');
  assert.match(s, /dgclaw-estaticos-v(1[5-9]|[2-9][0-9])\b/);
  assert.match(s, /'\/menu-lado\.js'/);
  assert.match(s, /'\/menu-lado\.css'/);
});

test('seletor: cada item usa a foto do próprio agente, não a do agente atual', () => {
  const ana = { id: 'ana', nome: 'Ana', cor: '#aa0000', avatar_img: '/fotos/ana.png' };
  const bento = { id: 'bento', nome: 'Bento', cor: '#0000bb', avatar_img: '/fotos/bento.png' };
  const caio = { id: 'caio', nome: 'Caio', cor: '#00cc00', avatar: 'C' };
  const hAna = M.itemAgente(ana, 'bento'), hBento = M.itemAgente(bento, 'bento'), hCaio = M.itemAgente(caio, 'bento');
  assert.match(hAna, /src="\/fotos\/ana\.png"/);
  assert.doesNotMatch(hAna, /bento\.png/);
  assert.match(hBento, /src="\/fotos\/bento\.png"/);
  assert.match(hBento, /aqui/);
  assert.doesNotMatch(hAna, /aqui/);
  assert.match(hCaio, /background:#00cc00/);
  assert.match(hCaio, />C</);
  assert.doesNotMatch(hCaio, /<img/);
  assert.match(hCaio, /href="\/a\/caio"/);
});

test('seletor: nome com HTML não vira marcação', () => {
  const h = M.itemAgente({ id: 'x', nome: '<b>"x"</b>' }, 'y');
  assert.doesNotMatch(h, /<b>"x"/);
});

test('páginas do painel: 13 links com #aba=, e nenhum sem painel', () => {
  const l = M.linksPainel({ id: 'ana', tem_painel: true, painel_url: '/p/ana/' });
  assert.deepEqual(l.map(x => x.href.split('#aba=')[1]),
    ['status', 'skills', 'rotinas', 'cofre', 'arquivos', 'memory', 'operations', 'costs', 'como', 'identity', 'personality', 'apps', 'socorro']);
  assert.ok(l.every(x => x.href.startsWith('/p/ana/#aba=')));
  assert.deepEqual(M.linksPainel({ id: 'admin', tem_painel: false }), []);
});

test('instalar o app: instalado some, prompt do Chrome, iPhone explica, resto explica o porquê', () => {
  assert.equal(M.instrucaoInstalar({ standalone: true }).tipo, 'instalado');
  assert.equal(M.instrucaoInstalar({ promptGuardado: true }).tipo, 'prompt');
  const ios = M.instrucaoInstalar({ ios: true });
  assert.equal(ios.tipo, 'ios');
  assert.match(ios.texto, /Adicionar à Tela de Início/);
  assert.match(M.instrucaoInstalar({}).texto, /não oferece/);
});

test('manifesto instalável: standalone, start_url, ícones 192/512 e maskable existem', () => {
  const m = JSON.parse(pub('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(__dirname, '../public', i.src)), i.src);
  assert.ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512'));
});

test('trocar foto: recorte quadrado pelo centro e conferência do arquivo escolhido', () => {
  const M = require('../public/menu-lado.js');
  assert.deepEqual(M.recorteQuadrado(800, 600), { sx: 100, sy: 0, lado: 600 });
  assert.deepEqual(M.recorteQuadrado(300, 1001), { sx: 0, sy: 350, lado: 300 });
  assert.deepEqual(M.recorteQuadrado(512, 512), { sx: 0, sy: 0, lado: 512 });
  assert.equal(M.problemaArquivo({ type: 'image/jpeg', name: 'a.jpg', size: 3e6 }), '');
  assert.equal(M.problemaArquivo({ type: '', name: 'IMG_1.HEIC', size: 3e6 }), '', 'tipo vazio: o navegador tenta abrir');
  assert.match(M.problemaArquivo({ type: 'application/pdf', name: 'a.pdf', size: 10 }), /não é uma foto/);
  assert.match(M.problemaArquivo({ type: 'image/svg+xml', name: 'a.svg', size: 10 }), /SVG/);
  assert.match(M.problemaArquivo({ type: 'image/png', name: 'a.png', size: 50 * 1024 * 1024 }), /grande demais/);
  assert.match(M.problemaArquivo(null), /Nenhuma/);
  for (const t of [M.problemaArquivo({ type: 'application/pdf' }), M.problemaArquivo({ type: 'image/svg+xml' }), M.problemaArquivo({ type: 'image/png', size: 9e9 })]) {
    assert.doesNotMatch(t, /[—–]/, 'sem travessão no texto da tela');
  }
});

test('enquadrar foto: cobre o quadro, zoom de 1 a 4, nunca deixa sobra e recorta o que está no círculo', () => {
  const M = require('../public/menu-lado.js');
  const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
  // escala de cobrir: o menor lado da imagem ocupa o quadro
  perto(M.escalaCobre(800, 600, 240), 0.4, 'cobre');
  perto(M.escalaCobre(300, 1200, 240), 0.8, 'cobre em pé');
  // início: zoom 1 e centrado
  const a0 = M.ajusteInicial(800, 600, 240);
  assert.equal(a0.zoom, 1); perto(a0.x, -40, 'x centrado'); perto(a0.y, 0, 'y centrado');
  assert.deepEqual(M.recorteDoAjuste(a0), { sx: 100, sy: 0, lado: 600 });
  // arrastar além da borda prende: a imagem continua cobrindo o quadro
  const longe = M.moveAjuste(a0, 500, 500);
  perto(longe.x, 0, 'x preso na esquerda'); perto(longe.y, 0, 'y preso em cima');
  const outro = M.moveAjuste(a0, -500, -500);
  perto(outro.x, 240 - 320, 'x preso na direita'); perto(outro.y, 0, 'sem folga vertical no zoom 1');
  // zoom limitado entre 1 e ZOOM_MAX
  assert.equal(M.ZOOM_MAX, 4);
  assert.equal(M.zoomNoPonto(a0, 9, 120, 120).zoom, 4);
  assert.equal(M.zoomNoPonto(a0, 0.2, 120, 120).zoom, 1);
  assert.equal(M.limitaAjuste({ w: 10, h: 10, lado: 100, zoom: 'x', x: 0, y: 0 }).zoom, 1);
  // zoom 2 no centro: o centro do quadro continua no centro da imagem
  const z2 = M.zoomNoPonto(a0, 2, 120, 120);
  const r2 = M.recorteDoAjuste(z2);
  perto(r2.lado, 300, 'lado no zoom 2'); perto(r2.sx + r2.lado / 2, 400, 'centro x'); perto(r2.sy + r2.lado / 2, 300, 'centro y');
  // zoom no canto mantém o canto parado
  const zc = M.zoomNoPonto(M.moveAjuste(a0, 500, 0), 3, 0, 0);
  perto(zc.x, 0, 'canto x'); perto(zc.y, 0, 'canto y');
  const rc = M.recorteDoAjuste(zc);
  perto(rc.sx, 0, 'recorte começa no canto'); perto(rc.lado, 200, 'lado no zoom 3');
  // em qualquer pan/zoom o recorte fica dentro da imagem
  let a = a0;
  for (const [dx, dy, z] of [[37, -900, 1.7], [-2000, 15, 3.9], [999, 999, 4], [-3, -3, 1]]) {
    a = M.zoomNoPonto(M.moveAjuste(a, dx, dy), z, 60, 200);
    const r = M.recorteDoAjuste(a);
    assert.ok(r.sx >= 0 && r.sy >= 0 && r.sx + r.lado <= 800 + 1e-9 && r.sy + r.lado <= 600 + 1e-9, JSON.stringify(r));
    assert.ok(a.x <= 0 && a.y <= 0, 'sem sobra em cima/esquerda');
  }
});

test('enquadrar foto: a folha traz o controle com rótulo e a dica em português sem travessão', () => {
  const js = pub('menu-lado.js');
  assert.match(js, /<label for="mlFotoZoom"[^>]*>Aproximar a foto<\/label>/);
  assert.match(js, /arraste para posicionar e use o controle para aproximar/);
  assert.match(js, /setPointerCapture/);
  assert.match(pub('menu-lado.css'), /\.ml-fs-corte\{[^}]*touch-action:none/);
  assert.match(pub('sw.js'), /dgclaw-estaticos-v(2[7-9]|[3-9][0-9])\b/);
  const textos = js.slice(js.indexOf('function folhaFoto')).match(/'[^'\n]*[a-zà-ú][^'\n]*'/g) || [];
  for (const t of textos) assert.doesNotMatch(t, /[—–]/, t);
});
