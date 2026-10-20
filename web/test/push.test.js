'use strict';
// Avisos no aparelho: cifra aes128gcm (RFC 8291), JWT VAPID (RFC 8292), inscrições e rotas.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { criarPush, cifrar, hostPermitido } = require('../lib/push');
const { subirWeb, pastaTemp, capturaLog } = require('./ajuda');

const b64u = (b) => Buffer.from(b).toString('base64url');
const deB64u = (s) => Buffer.from(s, 'base64url');

/** O aparelho: um par ECDH e um segredo auth, como o navegador gera na inscrição. */
function aparelho(host) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh, auth,
    sub: { endpoint: `https://${host || 'fcm.googleapis.com'}/send/${crypto.randomBytes(6).toString('hex')}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } },
  };
}

/** O lado do navegador (RFC 8291 seção 3): decifra o corpo recebido. */
function decifra(corpo, ecdhUa, auth) {
  const sal = corpo.subarray(0, 16);
  const rs = corpo.readUInt32BE(16);
  const idlen = corpo[20];
  const asPub = corpo.subarray(21, 21 + idlen);
  const cif = corpo.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const uaPub = ecdhUa.getPublicKey();
  const segredo = ecdhUa.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', segredo, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, sal, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, sal, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cif.subarray(cif.length - 16));
  const claro = Buffer.concat([d.update(cif.subarray(0, cif.length - 16)), d.final()]);
  assert.equal(claro[claro.length - 1], 2, 'delimitador do último registro');
  return claro.subarray(0, claro.length - 1);
}

function semear(dataDir, itens) {
  fs.mkdirSync(path.join(dataDir, 'push'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dataDir, 'push', 'inscricoes.json'), JSON.stringify({ versao: 1, itens }));
}
const lerInsc = (dataDir) => JSON.parse(fs.readFileSync(path.join(dataDir, 'push', 'inscricoes.json'), 'utf8')).itens;
const item = (n, ap) => Object.assign({ id: `ins_${n}`, aparelho: `Aparelho ${n}`, criada_em: '2026-10-01T00:00:00.000Z', ultimo_ok_em: null, ultima_falha: null }, ap.sub);

test('a cifra bate byte a byte com o exemplo da RFC 8291 (seção 5)', () => {
  const corpo = cifrar(
    Buffer.from('When I grow up, I want to be a watermelon'),
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg',
    { efemera: deB64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), sal: deB64u('DGv6ra1nlYgDCS1FRnbzlw') },
  );
  assert.equal(b64u(corpo), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('ida e volta: o aparelho decifra o que foi cifrado (acentos e emoji)', () => {
  const ap = aparelho();
  const msg = Buffer.from(JSON.stringify({ titulo: 'Hora do lembrete: água 💧' }));
  assert.deepEqual(decifra(cifrar(msg, ap.sub.keys.p256dh, ap.sub.keys.auth), ap.ecdh, ap.auth), msg);
});

test('cifrar recusa chave do aparelho malformada e aviso grande demais', () => {
  const ap = aparelho();
  assert.throws(() => cifrar(Buffer.from('x'), b64u(Buffer.alloc(10)), ap.sub.keys.auth), TypeError);
  assert.throws(() => cifrar(Buffer.from('x'), ap.sub.keys.p256dh, b64u(Buffer.alloc(8))), TypeError);
  assert.throws(() => cifrar(Buffer.alloc(4000), ap.sub.keys.p256dh, ap.sub.keys.auth), /teto/);
});

test('hostPermitido: só os serviços de push conhecidos', () => {
  for (const h of ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-par02p.notify.windows.com', 'a.push.services.mozilla.com']) assert.equal(hostPermitido(h), true, h);
  for (const h of ['evil.example.com', 'push.apple.com', 'fcm.googleapis.com.evil.com', 'notfcm.googleapis.com', 'localhost', '127.0.0.1']) assert.equal(hostPermitido(h), false, h);
});

test('chaves: geradas com pasta 0700 e arquivo 0600, formato esperado, e a mesma na segunda leitura', () => {
  const dir = pastaTemp('push');
  const p = criarPush({ dataDir: dir, log: capturaLog().log });
  const c = p.garantirChaves();
  assert.equal(c.criada, true);
  assert.equal(deB64u(c.publica).length, 65);
  assert.equal(deB64u(c.publica)[0], 4);
  assert.equal(deB64u(c.privada).length, 32);
  assert.equal(fs.statSync(path.join(dir, 'push')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(dir, 'push', 'vapid.json')).mode & 0o777, 0o600);
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'push', 'vapid.json'), 'utf8'));
  assert.deepEqual(Object.keys(j).sort(), ['criado_em', 'privada', 'publica']);
  const outro = criarPush({ dataDir: dir, log: capturaLog().log });
  assert.equal(outro.chavePublica(), c.publica);
  assert.equal(outro.garantirChaves().criada, false);
});

test('chaves: arquivo ilegível lança com o caminho e a orientação, e nunca é sobrescrito', () => {
  const dir = pastaTemp('push');
  fs.mkdirSync(path.join(dir, 'push'), { mode: 0o700 });
  const arq = path.join(dir, 'push', 'vapid.json');
  for (const lixo of ['isto não é json', '{"publica":"abc","privada":"def"}']) {
    fs.writeFileSync(arq, lixo);
    const p = criarPush({ dataDir: dir, log: capturaLog().log });
    assert.throws(() => p.garantirChaves(), (e) => e.message.includes(arq) && /Não apague: restaure do backup/.test(e.message) && /mova o arquivo e reinicie/.test(e.message));
    assert.equal(fs.readFileSync(arq, 'utf8'), lixo, 'o arquivo não foi tocado');
  }
});

test('enviar: cifra de verdade, JWT verificável, 201 ok, 410 remove, 500 vira falha, rede não lança', async () => {
  const dir = pastaTemp('push');
  const aps = [aparelho(), aparelho('updates.push.services.mozilla.com'), aparelho('web.push.apple.com'), aparelho('fcm.googleapis.com')];
  semear(dir, aps.map((a, i) => item(i + 1, a)));
  const pedidos = [];
  const cap = capturaLog();
  const push = criarPush({
    dataDir: dir, log: cap.log,
    enviarHttp: async (r) => {
      pedidos.push(r);
      if (r.url === aps[1].sub.endpoint) return { status: 410, corpo: 'gone' };
      if (r.url === aps[2].sub.endpoint) return { status: 500, corpo: 'x'.repeat(500) };
      if (r.url === aps[3].sub.endpoint) throw new Error('ECONNRESET');
      return { status: 201, corpo: '' };
    },
  });
  const aviso = { titulo: 'Hora do lembrete', corpo: 'ligar pro contador', tag: 'lembrete-oc_1', url: '/a/luna#x', acoes: [{ acao: 'feito', titulo: 'Feito', post: '/api/v1/lembretes/oc_1/feito' }], exigir_interacao: true };
  const r = await push.enviar(aviso);
  assert.equal(r.inscricoes, 4);
  assert.equal(r.ok, 1);
  assert.equal(r.removidas, 1);
  assert.equal(r.falhas.length, 2);
  const f500 = r.falhas.find((f) => f.status === 500);
  assert.equal(f500.id, 'ins_3'); assert.equal(f500.servico, 'web.push.apple.com'); assert.equal(f500.motivo.length, 300);
  const frede = r.falhas.find((f) => f.id === 'ins_4');
  assert.equal(frede.status, null); assert.match(frede.motivo, /ECONNRESET/);

  // o primeiro pedido: cabeçalhos, cifra decifrável pelo aparelho e JWT assinado
  const p1 = pedidos.find((x) => x.url === aps[0].sub.endpoint);
  assert.equal(p1.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(p1.headers.TTL, '3600');
  assert.equal(p1.headers.Urgency, 'high');
  assert.equal(p1.timeoutMs, 15000);
  const claro = JSON.parse(decifra(p1.corpo, aps[0].ecdh, aps[0].auth).toString('utf8'));
  assert.deepEqual(claro, { titulo: 'Hora do lembrete', corpo: 'ligar pro contador', tag: 'lembrete-oc_1', url: '/a/luna#x', imagem: null, acoes: aviso.acoes, exigir_interacao: true });
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(p1.headers.Authorization);
  assert.ok(m, 'formato do Authorization');
  assert.equal(m[2], push.chavePublica());
  const [cab, corpoJwt, assin] = m[1].split('.');
  assert.deepEqual(JSON.parse(deB64u(cab)), { typ: 'JWT', alg: 'ES256' });
  const cl = JSON.parse(deB64u(corpoJwt));
  assert.equal(cl.aud, 'https://fcm.googleapis.com');
  assert.equal(cl.sub, 'mailto:dgclaw@localhost');
  assert.ok(cl.exp > Date.now() / 1000 && cl.exp <= Date.now() / 1000 + 24 * 3600);
  const pub = deB64u(push.chavePublica());
  const chavePub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  assert.equal(deB64u(assin).length, 64);
  assert.equal(crypto.verify('sha256', Buffer.from(`${cab}.${corpoJwt}`), { key: chavePub, dsaEncoding: 'ieee-p1363' }, deB64u(assin)), true);
  // o segundo envio para o mesmo serviço reaproveita o JWT (cache por aud)
  const antes = pedidos.length;
  await push.enviar({ titulo: 'de novo' }, { endpoint: aps[0].sub.endpoint });
  assert.equal(pedidos.length, antes + 1);
  assert.equal(pedidos[antes].headers.Authorization, p1.headers.Authorization);

  const dep = lerInsc(dir);
  assert.deepEqual(dep.map((i) => i.id), ['ins_1', 'ins_3', 'ins_4'], 'a 410 saiu');
  assert.ok(dep[0].ultimo_ok_em);
  assert.equal(dep[1].ultima_falha.status, 500);
  assert.equal(dep[2].ultima_falha.status, null);
  assert.doesNotMatch(cap.texto(), new RegExp(aps[0].sub.endpoint.split('/').pop()), 'o endpoint não vai inteiro para o log');
  assert.doesNotMatch(cap.texto(), /vapid t=/);
});

test('enviar: sem inscrições devolve zeros; aviso inválido é erro de programação (TypeError)', async () => {
  const dir = pastaTemp('push');
  const push = criarPush({ dataDir: dir, log: capturaLog().log, enviarHttp: async () => { throw new Error('não devia enviar'); } });
  assert.deepEqual(await push.enviar({ titulo: 'x' }), { inscricoes: 0, ok: 0, removidas: 0, falhas: [] });
  await assert.rejects(() => push.enviar({ corpo: 'sem título' }), TypeError);
  await assert.rejects(() => push.enviar({ titulo: 'x', url: 'http://fora.com/' }), /precisa ser um caminho do próprio Web/);
  await assert.rejects(() => push.enviar({ titulo: 'x', url: '//fora.com' }), TypeError);
  await assert.rejects(() => push.enviar({ titulo: 'x', imagem: 'https://fora.com/a.png' }), TypeError);
  await assert.rejects(() => push.enviar({ titulo: 'x', acoes: [{ acao: 'a', titulo: 'A', post: 'https://fora.com' }] }), TypeError);
  await assert.rejects(() => push.enviar({ titulo: 'x', acoes: [1, 2, 3].map((n) => ({ acao: `a${n}`, titulo: 'A' })) }), /no máximo 2/);
});

test('enviar: arquivo de inscrições ilegível devolve a falha e não é apagado', async () => {
  const dir = pastaTemp('push');
  fs.mkdirSync(path.join(dir, 'push'), { mode: 0o700 });
  const arq = path.join(dir, 'push', 'inscricoes.json');
  fs.writeFileSync(arq, '{quebrado');
  const push = criarPush({ dataDir: dir, log: capturaLog().log, enviarHttp: async () => ({ status: 201, corpo: '' }) });
  const r = await push.enviar({ titulo: 'x' });
  assert.equal(r.inscricoes, 0);
  assert.match(r.falhas[0].motivo, /inscrições dos avisos/);
  assert.equal(fs.readFileSync(arq, 'utf8'), '{quebrado');
});

// ── rotas, com o servidor de verdade ─────────────────────────────────────────
async function servidor(comportamento) {
  const estado = { responde: comportamento || (() => ({ status: 201, corpo: '' })), pedidos: [] };
  const t = await subirWeb({ opcoesServidor: { enviarPush: async (r) => { estado.pedidos.push(r); return estado.responde(r); } } });
  await t.login();
  return { t, estado };
}

test('rotas: exigem login e Origin; chave pública bate com o vapid.json', async () => {
  const { t } = await servidor();
  try {
    const anon = await t.c.pedir('GET', '/api/v1/push/chave', { semCookie: true });
    assert.equal(anon.status, 401);
    const sem = await t.c.post('/api/v1/push/teste', { json: {}, origin: false });
    assert.equal(sem.status, 403);
    const r = await t.c.get('/api/v1/push/chave');
    assert.equal(r.status, 200);
    const j = JSON.parse(fs.readFileSync(path.join(t.dados, 'push', 'vapid.json'), 'utf8'));
    assert.equal(r.json.chave_publica, j.publica);
    assert.equal((await t.c.get('/api/v1/push/docs.md')).status, 200);
    assert.match((await t.c.get('/api/v1/push/docs.md')).texto, /# Avisos no aparelho/);
    assert.equal((await t.c.get('/api/v1/push/inexistente')).status, 404);
    assert.equal((await t.c.post('/api/v1/push/chave', { json: {} })).status, 405);
  } finally { await t.fechar(); }
});

test('rotas: inscrever (201 e 200), listar sem segredos, conferir, remover (200 e 404)', async () => {
  const { t } = await servidor();
  try {
    const ap = aparelho();
    const nova = await t.c.post('/api/v1/push/inscricoes', { json: Object.assign({ aparelho: 'Celular do Danilo' }, ap.sub) });
    assert.equal(nova.status, 201);
    assert.match(nova.json.id, /^ins_[0-9a-f]{16}$/);
    const igual = await t.c.post('/api/v1/push/inscricoes', { json: ap.sub });
    assert.equal(igual.status, 200);
    assert.equal(igual.json.id, nova.json.id);

    const lista = await t.c.get('/api/v1/push/inscricoes');
    assert.equal(lista.json.inscricoes.length, 1);
    assert.deepEqual(Object.keys(lista.json.inscricoes[0]).sort(), ['aparelho', 'criada_em', 'id', 'servico', 'ultima_falha', 'ultimo_ok_em']);
    assert.equal(lista.json.inscricoes[0].servico, 'fcm.googleapis.com');
    assert.equal(lista.json.inscricoes[0].aparelho, 'Celular do Danilo');
    assert.doesNotMatch(lista.texto, /send\/|p256dh|auth/);

    assert.deepEqual((await t.c.post('/api/v1/push/inscricoes/confere', { json: { endpoint: ap.sub.endpoint } })).json, { ok: true, inscrito: true, id: nova.json.id });
    assert.equal((await t.c.post('/api/v1/push/inscricoes/confere', { json: { endpoint: 'https://fcm.googleapis.com/outro' } })).json.inscrito, false);

    assert.equal((await t.c.post('/api/v1/push/inscricoes/remover', { json: {} })).status, 400);
    assert.equal((await t.c.post('/api/v1/push/inscricoes/remover', { json: { id: nova.json.id } })).status, 200);
    assert.equal((await t.c.post('/api/v1/push/inscricoes/remover', { json: { id: nova.json.id } })).status, 404);
    assert.equal((await t.c.post('/api/v1/push/inscricoes/remover', { json: { endpoint: ap.sub.endpoint } })).status, 404);
    assert.equal(fs.statSync(path.join(t.dados, 'push', 'inscricoes.json')).mode & 0o777, 0o600);
  } finally { await t.fechar(); }
});

test('rotas: inscrição inválida volta 400 com o motivo (host desconhecido, http, chaves ruins, nome grande)', async () => {
  const { t } = await servidor();
  try {
    const ap = aparelho();
    const ruim = async (alt, esperado) => {
      const r = await t.c.post('/api/v1/push/inscricoes', { json: Object.assign({}, ap.sub, alt) });
      assert.equal(r.status, 400, JSON.stringify(alt));
      assert.match(r.json.erro, esperado);
    };
    await ruim({ endpoint: 'https://evil.example.com/send/abc' }, /evil\.example\.com não é um dos aceitos/);
    await ruim({ endpoint: 'http://fcm.googleapis.com/send/abc' }, /https/);
    await ruim({ endpoint: 'https://127.0.0.1/send/abc' }, /não é um dos aceitos/);
    await ruim({ endpoint: 'https://fcm.googleapis.com:8443/send/abc' }, /https, sem usuário nem porta/);
    await ruim({ endpoint: undefined }, /endpoint/);
    await ruim({ keys: { p256dh: 'curta', auth: ap.sub.keys.auth } }, /p256dh/);
    await ruim({ keys: { p256dh: ap.sub.keys.p256dh, auth: 'curta' } }, /auth/);
    await ruim({ aparelho: 'x'.repeat(61) }, /até 60 caracteres/);
    assert.equal((await t.c.post('/api/v1/push/inscricoes', { corpo: '{nao-json', headers: { 'Content-Type': 'application/json' } })).status, 400);
    assert.equal((await t.c.get('/api/v1/push/inscricoes')).json.inscricoes.length, 0);
  } finally { await t.fechar(); }
});

test('rotas: teste devolve 409 sem aparelho, 200 com envio, 502 com recusa e 409 com inscrição morta', async () => {
  const { t, estado } = await servidor();
  try {
    const vazio = await t.c.post('/api/v1/push/teste', { json: {} });
    assert.equal(vazio.status, 409);
    assert.match(vazio.json.erro, /Nenhum aparelho/);

    const ap = aparelho(); const ap2 = aparelho('web.push.apple.com');
    await t.c.post('/api/v1/push/inscricoes', { json: ap.sub });
    await t.c.post('/api/v1/push/inscricoes', { json: ap2.sub });

    const ok = await t.c.post('/api/v1/push/teste', { json: {} });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true); assert.equal(ok.json.inscricoes, 2); assert.equal(ok.json.enviados, 2);
    assert.equal(estado.pedidos.length, 2);
    const claro = JSON.parse(decifra(estado.pedidos[0].corpo, ap.ecdh, ap.auth).toString('utf8'));
    assert.equal(claro.titulo, 'S2 Bot'); assert.equal(claro.tag, 'teste-aviso');

    estado.pedidos.length = 0;
    const so = await t.c.post('/api/v1/push/teste', { json: { endpoint: ap2.sub.endpoint } });
    assert.equal(so.json.inscricoes, 1);
    assert.equal(estado.pedidos.length, 1);
    assert.equal(estado.pedidos[0].url, ap2.sub.endpoint);

    estado.responde = () => ({ status: 403, corpo: 'VAPID rejeitado' });
    const recusa = await t.c.post('/api/v1/push/teste', { json: {} });
    assert.equal(recusa.status, 502);
    assert.match(recusa.json.erro, /status 403: VAPID rejeitado/);

    estado.responde = () => ({ status: 410, corpo: '' });
    const morta = await t.c.post('/api/v1/push/teste', { json: {} });
    assert.equal(morta.status, 409);
    assert.match(morta.json.erro, /vencido|removida/);
    assert.equal((await t.c.get('/api/v1/push/inscricoes')).json.inscricoes.length, 0);
  } finally { await t.fechar(); }
});

test('rotas: vapid ilegível devolve 503 explicando e o arquivo continua como estava', async () => {
  const dados = path.join(pastaTemp('web'), 'dados');
  fs.mkdirSync(path.join(dados, 'push'), { recursive: true, mode: 0o700 });
  const arq = path.join(dados, 'push', 'vapid.json');
  fs.writeFileSync(arq, 'lixo');
  const t = await subirWeb({ opcoesServidor: { dataDir: dados } });
  try {
    await t.login();
    const r = await t.c.get('/api/v1/push/chave');
    assert.equal(r.status, 503);
    assert.ok(r.json.erro.includes(arq));
    assert.match(r.json.erro, /Não apague: restaure do backup/);
    assert.equal(fs.readFileSync(arq, 'utf8'), 'lixo');
    assert.match(t.log.texto(), /\[erro\] O arquivo de chaves dos avisos/);
  } finally { await t.fechar(); }
});
