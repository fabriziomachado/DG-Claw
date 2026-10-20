'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { subirWeb, pastaTemp } = require('./ajuda');
const { tipoPelosBytes } = require('../lib/avatar');

// Imagem real de teste, feita pelo próprio ffmpeg (retângulo 80x40: a foto sai quadrada).
function imagem(formato) {
  const saida = path.join(pastaTemp('img'), 'x.' + formato);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=80x40', '-frames:v', '1', saida]);
  return fs.readFileSync(saida);
}

async function cenario() {
  const agentes = [
    { slug: 'admin', nome: 'Admin', tipo: 'admin', runner: 'http://127.0.0.1:9', agente_id: 'a', chat_id: 'c_admin', avatar: '🛠', cor: '#333333' },
    { slug: 'ana', nome: 'ana', tipo: 'agente', runner: 'http://127.0.0.1:9', agente_id: 'b', chat_id: 'c_ana', avatar: 'https://exemplo.com/ana.png', cor: '#aa0000' },
  ];
  const t = await subirWeb({ agentes });
  await t.login();
  return t;
}
const put = (t, slug, corpo, o) => t.c.pedir('PUT', '/api/v1/agents/' + slug + '/avatar', Object.assign({ corpo, headers: { 'Content-Type': 'image/png' } }, o));
const ana = async t => (await t.c.get('/api/v1/agents')).json.agentes.find(a => a.id === 'ana');

test('tipoPelosBytes: PNG, JPEG e WebP pela assinatura; SVG, GIF e texto não', () => {
  assert.equal(tipoPelosBytes(imagem('png')), 'png_pipe');
  assert.equal(tipoPelosBytes(imagem('jpg')), 'jpeg_pipe');
  assert.equal(tipoPelosBytes(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp_pipe');
  assert.equal(tipoPelosBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(tipoPelosBytes(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00')), null);
  assert.equal(tipoPelosBytes(Buffer.from('x')), null);
});

test('avatar: troca, aparece em /agents, serve WebP quadrada e remove (letra)', async () => {
  const t = await cenario();
  try {
    assert.equal((await ana(t)).avatar_img, 'https://exemplo.com/ana.png');
    const r = await put(t, 'ana', imagem('png'));
    assert.equal(r.status, 200, r.texto);
    assert.match(r.json.agente.avatar_img, /^\/api\/v1\/agents\/ana\/avatar\?v=[0-9a-z]+$/);
    assert.equal(r.json.agente.avatar, 'A');
    assert.equal((await ana(t)).avatar_img, r.json.agente.avatar_img);
    const f = await t.c.get(r.json.agente.avatar_img);
    assert.equal(f.status, 200);
    assert.equal(f.headers['content-type'], 'image/webp');
    assert.equal(f.headers['x-content-type-options'], 'nosniff');
    assert.equal(tipoPelosBytes(f.buf), 'webp_pipe');
    const arq = path.join(t.dados, 'avatares', 'ana.webp');
    assert.equal(fs.statSync(arq).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(path.join(t.dados, 'avatares')), ['ana.webp']);   // sem temporário sobrando
    const dim = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', arq]).toString().trim();
    assert.equal(dim, '512,512');
    // JPEG também vale e troca a anterior
    assert.equal((await put(t, 'ana', imagem('jpg'), { headers: { 'Content-Type': 'image/jpeg' } })).status, 200);

    const d = await t.c.pedir('DELETE', '/api/v1/agents/ana/avatar');
    assert.equal(d.status, 200, d.texto);
    assert.equal(d.json.agente.avatar_img, null);
    assert.equal(d.json.agente.avatar, 'A');
    assert.equal((await ana(t)).avatar_img, null, 'removida vale por cima do avatar do registro');
    assert.equal((await t.c.get('/api/v1/agents/ana/avatar')).status, 404);
    // depois de remover, trocar de novo volta a ter foto
    assert.equal((await put(t, 'ana', imagem('png'))).status, 200);
    assert.match((await ana(t)).avatar_img, /\/avatar\?v=/);
  } finally { await t.fechar(); }
});

test('avatar: recusa SVG, HTML com extensão de imagem, vazio, acima de 5 MB e imagem quebrada', async () => {
  const t = await cenario();
  try {
    const svg = await put(t, 'ana', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { headers: { 'Content-Type': 'image/svg+xml' } });
    assert.equal(svg.status, 415); assert.match(svg.json.erro, /PNG, JPEG ou WebP/);
    assert.equal((await put(t, 'ana', Buffer.from('<html><script>x</script></html>'))).status, 415);
    assert.equal((await put(t, 'ana', Buffer.alloc(0))).status, 400);
    const grande = Buffer.concat([imagem('png'), Buffer.alloc(5 * 1024 * 1024)]);
    const g = await put(t, 'ana', grande);
    assert.equal(g.status, 413); assert.match(g.json.erro, /5 MB/);
    // assinatura de PNG com lixo depois: o ffmpeg não abre, nada é gravado
    const quebrada = Buffer.concat([imagem('png').subarray(0, 8), Buffer.alloc(200, 7)]);
    const q = await put(t, 'ana', quebrada);
    assert.equal(q.status, 415); assert.match(q.json.erro, /Não consegui abrir/);
    assert.equal(fs.existsSync(path.join(t.dados, 'avatares', 'ana.webp')), false);
    const sobra = fs.existsSync(path.join(t.dados, 'avatares')) ? fs.readdirSync(path.join(t.dados, 'avatares')) : [];
    assert.deepEqual(sobra, []);
  } finally { await t.fechar(); }
});

test('avatar: agente inexistente, slug esquisito, sem login, sem Origin e método errado', async () => {
  const t = await cenario();
  try {
    assert.equal((await put(t, 'bento', imagem('png'))).status, 404);
    assert.equal((await put(t, '..%2F..%2Fetc', imagem('png'))).status, 404);
    assert.equal((await put(t, 'ana', imagem('png'), { origin: false })).status, 403);
    assert.equal((await put(t, 'ana', imagem('png'), { semCookie: true })).status, 401);
    assert.equal((await t.c.pedir('PATCH', '/api/v1/agents/ana/avatar')).status, 405);
    // o Admin também pode ter foto: só muda a tela
    const r = await put(t, 'admin', imagem('png'));
    assert.equal(r.status, 200);
    assert.match(r.json.agente.avatar_img, /^\/api\/v1\/agents\/admin\/avatar\?v=/);
  } finally { await t.fechar(); }
});

test('avatar: pedido vindo da caixa de um agente é recusado', async () => {
  const { criarAvatares } = require('../lib/avatar');
  const dir = pastaTemp('av');
  const av = criarAvatares({ dataDir: dir, registro: { obter: s => (s === 'ana' ? { slug: 'ana' } : null) }, log: () => {} });
  let status = 0, corpo = null;
  const h = { erroJson: (res, s, e) => { status = s; corpo = e; }, enviaJson: () => { throw new Error('não devia responder ok'); }, lerCorpo: async () => imagem('png'), agentePublico: async a => a };
  const ok = await av.tratar({ method: 'PUT' }, {}, new URL('http://x/api/v1/agents/ana/avatar'), { via: 'caixa', agente: 'ana' }, h);
  assert.equal(ok, true); assert.equal(status, 403); assert.match(corpo, /dono/);
  assert.equal(fs.existsSync(path.join(dir, 'avatares')), false);
  assert.equal(await av.tratar({ method: 'GET' }, {}, new URL('http://x/api/v1/agents/ana/outra'), {}, h), false);
});
