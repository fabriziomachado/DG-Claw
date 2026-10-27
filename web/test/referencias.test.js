'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { criarReferencias, extraiUrl, fonteDe, motivoInterno, tipoArquivo } = require('../lib/referencias');

function monta(opcoes = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'refs-'));
  const recados = [];
  const registro = { obter: slug => (slug === 'tech' ? { slug: 'tech' } : null) };
  const runner = { input: async (ag, corpo) => { recados.push({ ag: ag.slug, corpo }); return { ok: true }; } };
  let t = 1000;
  const refs = criarReferencias({ pasta, registro, runner, log: () => {}, agora: () => t, resolve: async () => '', ...opcoes });
  return { refs, pasta, recados, passa: ms => { t += ms; } };
}

function pedido(corpo, headers) {
  const req = Readable.from([Buffer.from(corpo)]);
  req.headers = headers || {};
  return req;
}
function resposta() {
  const r = { status: 0, corpo: null };
  r.writeHead = (s) => { r.status = s; };
  r.setHeader = () => {};
  r.end = (b) => { r.corpo = b ? JSON.parse(String(b)) : null; };
  return r;
}

test('extraiUrl pega o link do texto do compartilhar e limpa a pontuação do fim', async () => {
  assert.strictEqual(extraiUrl('olha isso https://x.com/swyx/status/123).'), 'https://x.com/swyx/status/123');
  assert.strictEqual(extraiUrl('sem link'), null);
  assert.strictEqual(extraiUrl('javascript:alert(1)'), null);
  assert.strictEqual(fonteDe('https://www.twitter.com/a'), 'x.com');
});

test('adicionar só guarda (sem acionar o curador) e não repete o mesmo link; resumir aciona uma vez', async () => {
  const { refs, recados } = monta();
  const a = await refs.adicionar({ url: 'https://dagger.io/blog/x', origem: 'tela' });
  assert.strictEqual(a.repetida, false);
  assert.strictEqual(a.ref.fonte, 'dagger.io');
  assert.strictEqual(a.ref.estado, 'guardada');
  const b = await refs.adicionar({ url: 'veja https://dagger.io/blog/x' });
  assert.strictEqual(b.repetida, true);
  assert.strictEqual(b.ref.id, a.ref.id);
  await new Promise(r => setImmediate(r));
  assert.strictEqual(recados.length, 0, 'guardar não chama agente');
  assert.strictEqual(refs.resumir(a.ref.id).estado, 'nova');
  refs.resumir(a.ref.id);
  await new Promise(r => setImmediate(r));
  assert.strictEqual(recados.length, 1, 'pedido repetido enquanto espera não chama de novo');
  assert.match(recados[0].corpo.text, /referencia-nova/);
  assert.match(recados[0].corpo.text, /dgclaw-api PATCH \/api\/v1\/referencias\/1 /);
  assert.strictEqual(recados[0].corpo.injectWhenIdle, true);
  assert.strictEqual(refs.resumir('99'), null);
});

test('atualizar grava o resumo, limita assuntos a 3 sem repetir e marca pronta; erro marca erro', async () => {
  const { refs } = monta();
  const { ref } = await refs.adicionar({ url: 'https://a.com' });
  const r = refs.atualizar(ref.id, { titulo: ' Título ', resumo: 'Resumo.', assuntos: ['IA', 'ia', 'Agentes', 'DevOps', 'Mais'] });
  assert.strictEqual(r.estado, 'pronta');
  assert.strictEqual(r.titulo, 'Título');
  assert.deepStrictEqual(r.assuntos, ['IA', 'Agentes', 'DevOps']);
  assert.strictEqual(refs.atualizar(ref.id, { erro: 'página exige login' }).estado, 'erro');
  assert.strictEqual(refs.atualizar('99', { titulo: 'x' }), null);
});

test('listar filtra por palavra e por assunto, da mais nova para a mais velha, e conta os assuntos', async () => {
  const { refs, passa } = monta();
  const a = (await refs.adicionar({ url: 'https://a.com' })).ref;
  passa(1);
  const b = (await refs.adicionar({ url: 'https://b.com' })).ref;
  refs.atualizar(a.id, { titulo: 'Agentes que se vigiam', assuntos: ['Agentes'] });
  refs.atualizar(b.id, { titulo: 'Dagger', assuntos: ['DevOps', 'Agentes'] });
  const tudo = refs.listar();
  assert.deepStrictEqual(tudo.itens.map(x => x.id), [b.id, a.id]);
  assert.deepStrictEqual(tudo.assuntos, [{ nome: 'Agentes', n: 2 }, { nome: 'DevOps', n: 1 }]);
  assert.deepStrictEqual(refs.listar({ q: 'vigiam' }).itens.map(x => x.id), [a.id]);
  assert.deepStrictEqual(refs.listar({ assunto: 'devops' }).itens.map(x => x.id), [b.id]);
});

test('entrada do Atalho: sem chave recusa; com a chave guarda o link do texto; chave nova derruba a antiga', async () => {
  const { refs, pasta } = monta();
  let res = resposta();
  await refs.entrada(pedido('https://a.com'), res, '1.1.1.1');
  assert.strictEqual(res.status, 401);
  const chave = refs.novaChave();
  assert.ok(!fs.readFileSync(path.join(pasta, 'atalho.json'), 'utf8').includes(chave), 'só o hash vai para o disco');
  res = resposta();
  await refs.entrada(pedido(JSON.stringify({ url: 'olha https://x.com/a/status/1' }), { authorization: 'Bearer ' + chave }), res, '1.1.1.1');
  assert.strictEqual(res.status, 201);
  assert.strictEqual(refs.listar().itens[0].origem, 'atalho');
  refs.novaChave();
  res = resposta();
  await refs.entrada(pedido('https://b.com', { authorization: 'Bearer ' + chave }), res, '1.1.1.1');
  assert.strictEqual(res.status, 401);
});

test('rota: agente não apaga nem mexe na chave do Atalho', async () => {
  const { refs } = monta();
  const { ref } = await refs.adicionar({ url: 'https://a.com' });
  const agente = { via: 'caixa', agente: 'tech' };
  let res = resposta();
  const req = pedido('');
  req.method = 'DELETE';
  await refs.rota(req, res, new URL('http://x/api/v1/referencias/' + ref.id), agente);
  assert.strictEqual(res.status, 403);
  res = resposta();
  const req2 = pedido('');
  req2.method = 'POST';
  await refs.rota(req2, res, new URL('http://x/api/v1/referencias/atalho'), agente);
  assert.strictEqual(res.status, 403);
});

test('endereço interno é recusado: IP privado, Tailscale, nome sem domínio, .local e o próprio servidor', async () => {
  for (const u of ['http://127.0.0.1:8300/x', 'http://10.0.0.5/', 'http://192.168.1.1', 'http://100.101.1.2/', 'http://169.254.169.254/latest',
    'http://[::1]/', 'http://bastion/', 'https://nas.local/', 'https://srv.tail1234.ts.net/', 'https://agent.exemplo.io/a']) {
    assert.ok(await motivoInterno(u, ['agent.exemplo.io']), u);
  }
  assert.strictEqual(await motivoInterno('http://8.8.8.8/', []), '');
  const { refs, recados } = monta({ resolve: u => motivoInterno(u, []) });
  await assert.rejects(refs.adicionar({ url: 'http://10.1.2.3/admin' }), /não pode ser guardado/);
  assert.strictEqual(refs.listar().total, 0);
  assert.strictEqual(recados.length, 0);
});

test('agente não guarda link; só o curador grava resumo', async () => {
  const { refs } = monta();
  const { ref } = await refs.adicionar({ url: 'https://a.com' });
  const corpo = JSON.stringify({ url: 'https://b.com' });
  let res = resposta(); let req = pedido(corpo, { 'content-type': 'application/json' }); req.method = 'POST';
  await refs.rota(req, res, new URL('http://x/api/v1/referencias'), { via: 'caixa', agente: 'tech' });
  assert.strictEqual(res.status, 403);
  res = resposta(); req = pedido(JSON.stringify({ titulo: 'x' }), { 'content-type': 'application/json' }); req.method = 'PATCH';
  await refs.rota(req, res, new URL('http://x/api/v1/referencias/' + ref.id), { via: 'caixa', agente: 'help' });
  assert.strictEqual(res.status, 403);
  res = resposta(); req = pedido(JSON.stringify({ titulo: 'Ok' }), { 'content-type': 'application/json' }); req.method = 'PATCH';
  await refs.rota(req, res, new URL('http://x/api/v1/referencias/' + ref.id), { via: 'caixa', agente: 'tech' });
  assert.strictEqual(res.status, 200);
});

// ── imagem, PDF e ajustes do compartilhar (25/10/2026) ──────────────────
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(40, 1)]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\ntrailer\n%%EOF\n');
function multipart(campos, arq) {
  const b = 'XyZfronteira';
  const partes = Object.entries(campos).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (arq) partes.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="arquivo"; filename="${arq.nome}"\r\nContent-Type: ${arq.tipo || 'application/octet-stream'}\r\n\r\n`), arq.dados, Buffer.from('\r\n'));
  partes.push(Buffer.from(`--${b}--\r\n`));
  return { corpo: Buffer.concat(partes), ct: `multipart/form-data; boundary=${b}` };
}
function pedidoBin(buf, headers) { const req = Readable.from([buf]); req.headers = headers || {}; return req; }

test('tipoArquivo reconhece pelos primeiros bytes e recusa SVG e texto', () => {
  assert.strictEqual(tipoArquivo(PNG).ext, 'png');
  assert.strictEqual(tipoArquivo(PDF).tipo, 'pdf');
  assert.strictEqual(tipoArquivo(Buffer.from('\x00\x00\x00\x18ftypheic\x00\x00\x00\x00', 'latin1')).ext, 'heic');
  assert.strictEqual(tipoArquivo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.strictEqual(tipoArquivo(Buffer.from('https://a.com/qualquer')), null);
});

test('ajustes: começa só com links, até 10 MB; agente não vê nem muda; tamanho fora da lista é recusado', async () => {
  const { refs } = monta();
  assert.deepStrictEqual(refs.ajustes(), { ligado: true, tipos: { link: true, imagem: false, pdf: false }, max_mb: 10 });
  assert.throws(() => refs.gravaAjustes({ max_mb: 7 }), /5, 10, 20, 50/);
  assert.strictEqual(refs.gravaAjustes({ tipos: { pdf: true }, max_mb: 20 }).tipos.pdf, true);
  assert.strictEqual(refs.ajustes().max_mb, 20);
  assert.strictEqual(refs.ajustes().tipos.link, true, 'mudar um tipo não mexe nos outros');
  const res = resposta(); const req = pedido(JSON.stringify({ ligado: false })); req.method = 'PUT';
  await refs.rota(req, res, new URL('http://x/api/v1/referencias/ajustes'), { via: 'caixa', agente: 'tech' });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(refs.ajustes().ligado, true);
});

test('entrada com arquivo: tipo desligado recusa; ligado guarda, não repete e respeita o tamanho máximo', async () => {
  const { refs, pasta } = monta();
  const chave = refs.novaChave();
  const auth = 'Bearer ' + chave;
  let m = multipart({}, { nome: 'print.png', tipo: 'image/png', dados: PNG });
  let res = resposta();
  await refs.entrada(pedidoBin(m.corpo, { authorization: auth, 'content-type': m.ct }), res, '1.1.1.1');
  assert.strictEqual(res.status, 403);
  assert.match(res.corpo.erro, /Imagens está desligado/);
  refs.gravaAjustes({ tipos: { imagem: true, pdf: true }, max_mb: 5 });
  res = resposta();
  await refs.entrada(pedidoBin(m.corpo, { authorization: auth, 'content-type': m.ct }), res, '1.1.1.1');
  assert.strictEqual(res.status, 201);
  const r = refs.listar().itens[0];
  assert.strictEqual(r.tipo, 'imagem');
  assert.strictEqual(r.arquivo.ext, 'png');
  assert.strictEqual(fs.statSync(path.join(pasta, 'arquivos', `${r.id}.png`)).mode & 0o777, 0o600);
  res = resposta();
  await refs.entrada(pedidoBin(m.corpo, { authorization: auth, 'content-type': m.ct }), res, '1.1.1.1');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.corpo.repetida, true);
  // PDF mandado cru (corpo "Arquivo" do Atalho)
  res = resposta();
  await refs.entrada(pedidoBin(PDF, { authorization: auth, 'content-type': 'application/pdf' }), res, '1.1.1.1');
  assert.strictEqual(res.status, 201);
  assert.strictEqual(refs.listar().itens.find(x => x.id === res.corpo.id).fonte, 'PDF');
  // grande demais
  m = multipart({}, { nome: 'g.pdf', dados: Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024)]) });
  res = resposta();
  await refs.entrada(pedidoBin(m.corpo, { authorization: auth, 'content-type': m.ct, 'content-length': String(m.corpo.length) }), res, '1.1.1.1');
  assert.strictEqual(res.status, 413);
  assert.match(res.corpo.erro, /limite é 5 MB/);
  // tipo que não é imagem nem PDF
  m = multipart({}, { nome: 'x.svg', dados: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">' + 'a'.repeat(40000) + '</svg>') });
  res = resposta();
  await refs.entrada(pedidoBin(m.corpo, { authorization: auth, 'content-type': m.ct }), res, '1.1.1.1');
  assert.strictEqual(res.status, 415);
});

test('compartilhar desligado recusa tudo; link desligado recusa link; texto em arquivo com link vale como link', async () => {
  const { refs } = monta();
  const auth = 'Bearer ' + refs.novaChave();
  refs.gravaAjustes({ ligado: false });
  let res = resposta();
  await refs.entrada(pedido('https://a.com', { authorization: auth }), res, '1.1.1.1');
  assert.strictEqual(res.status, 403);
  assert.match(res.corpo.erro, /desligado/);
  refs.gravaAjustes({ ligado: true, tipos: { link: false } });
  res = resposta();
  await refs.entrada(pedido('https://a.com', { authorization: auth }), res, '1.1.1.1');
  assert.strictEqual(res.status, 403);
  refs.gravaAjustes({ tipos: { link: true } });
  const m = multipart({}, { nome: 'texto.txt', tipo: 'text/plain', dados: Buffer.from('veja https://b.com/post') });
  res = resposta();
  await refs.entrada(pedidoBin(m.corpo, { authorization: auth, 'content-type': m.ct }), res, '1.1.1.1');
  assert.strictEqual(res.status, 201);
  assert.strictEqual(refs.listar().itens.find(x => x.id === res.corpo.id).url, 'https://b.com/post');
});

test('resumir arquivo copia para a casa do curador e o recado diz onde; apagar tira as duas cópias', async () => {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'casa-'));
  const registro = { obter: s => (s === 'tech' ? { slug: 'tech', home_host: casa, home_container: '/home/agente' } : null) };
  const { refs, recados, pasta } = monta({ registro });
  const { ref } = refs.adicionarArquivo({ dados: PDF, nome: 'Relatório 2026.pdf' });
  assert.strictEqual(ref.titulo, 'Relatório 2026');
  assert.ok(!fs.existsSync(path.join(casa, 'referencias')), 'guardar não leva nada ao curador');
  refs.resumir(ref.id);
  await new Promise(r => setImmediate(r));
  assert.ok(fs.existsSync(path.join(casa, 'referencias', `${ref.id}.pdf`)));
  assert.match(recados[0].corpo.text, new RegExp(`/home/agente/referencias/${ref.id}\\.pdf`));
  assert.match(recados[0].corpo.text, /pdftotext/);
  const res = { cab: null, writeHead(s, c) { this.status = s; this.cab = c; }, end(b) { this.corpo = b; } };
  const req = pedido(''); req.method = 'GET';
  await refs.rota(req, res, new URL(`http://x/api/v1/referencias/${ref.id}/arquivo`), { usuario: 'dono' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.cab['X-Content-Type-Options'], 'nosniff');
  assert.ok(PDF.equals(res.corpo));
  assert.strictEqual(refs.apagar(ref.id), true);
  assert.ok(!fs.existsSync(path.join(casa, 'referencias', `${ref.id}.pdf`)));
  assert.ok(!fs.existsSync(path.join(pasta, 'arquivos', `${ref.id}.pdf`)));
});
