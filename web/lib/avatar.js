'use strict';
// Foto do agente trocada pelo dono no menu (18/10/2026).
//
// A foto escolhida na criação continua onde está (anexo do pedido de onboarding). A troca vale
// por cima dela e fica em <dataDir>/avatares/: <slug>.webp (a foto) ou <slug>.removida (o dono
// tirou a foto; a tela mostra a letra com a cor do agente). Mesmas regras da foto da criação:
// PNG, JPEG ou WebP, até 5 MB. O tipo é conferido pelos primeiros bytes, e a foto é refeita pelo
// ffmpeg (quadrada, 512 px, sem metadados), então o que sai daqui é sempre uma imagem WebP nossa.
// Só o dono, no navegador, troca: pedido da caixa de um agente é recusado.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const executar = promisify(execFile);

const LIMITE_BYTES = 5 * 1024 * 1024;   // o mesmo da foto da criação (onboarding.js)
const LADO = 512;
const RX_SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const RX_ROTA = /^\/api\/v1\/agents\/([^/]+)\/avatar$/;
// Avatar dormindo (20/10/2026, pedido do dono): <slug>-adormecendo.webp (toca uma vez), <slug>-dormindo.webp
// (repete) e <slug>-dormindo.png (parado, para quem pede menos movimento), na mesma pasta das fotos.
// Trabalhando (20/10/2026): <slug>-trabalhando.webp (repete enquanto trabalha) e <slug>-trabalhando.png (parado).
// Precisa de você (21/10/2026): <slug>-pede.webp e <slug>-pede.png; travada: <slug>-travada.webp e .png.
const RX_ROTA_SONO = /^\/api\/v1\/agents\/([^/]+)\/avatar\/(adormecendo|dormindo|parado|trabalhando|trabalhando-parado|pede|pede-parado|travada|travada-parado)$/;
const ARQ_SONO = { adormecendo: '-adormecendo.webp', dormindo: '-dormindo.webp', parado: '-dormindo.png',
  trabalhando: '-trabalhando.webp', 'trabalhando-parado': '-trabalhando.png',
  pede: '-pede.webp', 'pede-parado': '-pede.png', travada: '-travada.webp', 'travada-parado': '-travada.png' };
const ERRO_TIPO = 'Escolha uma foto PNG, JPEG ou WebP.';

/** Tipo pela assinatura dos primeiros bytes. Devolve o demuxer do ffmpeg ou null. */
function tipoPelosBytes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png_pipe';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg_pipe';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp_pipe';
  return null;
}

function erro(texto, status = 400) { return Object.assign(new Error(texto), { status }); }

function criarAvatares({ dataDir, registro, log, ffmpeg = 'ffmpeg', timeoutMs = 20000 }) {
  const pasta = path.join(dataDir, 'avatares');
  const arqFoto = slug => path.join(pasta, slug + '.webp');
  const arqSem = slug => path.join(pasta, slug + '.removida');

  /** { url } se há foto trocada, { removida: true } se o dono tirou, ou null (vale a de antes). */
  function estado(slug) {
    if (!RX_SLUG.test(slug || '')) return null;
    try {
      const st = fs.statSync(arqFoto(slug));
      if (st.isFile() && st.size > 0) return { url: '/api/v1/agents/' + slug + '/avatar?v=' + Math.round(st.mtimeMs).toString(36) };
    } catch (e) { if (e.code !== 'ENOENT') log('aviso', `Foto de ${slug}: não li ${arqFoto(slug)} (${e.code || e.message}). Fica a foto anterior.`); }
    try { if (fs.statSync(arqSem(slug)).isFile()) return { removida: true }; } catch (_) { /* sem marca */ }
    return null;
  }

  /** { adormecendo, dormindo, parado, trabalhando, trabalhando-parado } com as URLs que existem, ou null se não há nenhuma. */
  function sono(slug) {
    if (!RX_SLUG.test(slug || '')) return null;
    const out = {};
    for (const [tipo, suf] of Object.entries(ARQ_SONO)) {
      try {
        const st = fs.statSync(path.join(pasta, slug + suf));
        if (st.isFile() && st.size > 0) out[tipo] = '/api/v1/agents/' + slug + '/avatar/' + tipo + '?v=' + Math.round(st.mtimeMs).toString(36);
      } catch (_) { /* esse pedaço não existe */ }
    }
    return out.dormindo || out.trabalhando || out.pede || out.travada ? out : null;
  }

  function servirSono(req, res, slug, tipo) {
    const arq = path.join(pasta, slug + ARQ_SONO[tipo]);
    let st;
    try { st = fs.lstatSync(arq); } catch (_) { st = null; }
    if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('Sem animação.'); }
    res.writeHead(200, {
      'Content-Type': /parado$/.test(tipo) ? 'image/png' : 'image/webp', 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(arq).on('error', () => res.destroy()).pipe(res);
  }

  function preparaPasta() {
    fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(pasta);
    if (!st.isDirectory() || st.isSymbolicLink()) throw erro('A pasta das fotos não é uma pasta comum. Peça ao Admin para conferir o servidor.', 500);
  }

  /** Grava `dados` em `destino` por um temporário na mesma pasta e rename (nunca fica meio arquivo). */
  function gravaAtomico(destino, dados) {
    const tmp = path.join(pasta, '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
    try {
      fs.writeFileSync(tmp, dados, { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, destino);
    } finally { try { fs.unlinkSync(tmp); } catch (_) { /* já virou o destino */ } }
  }

  function apaga(arq) { try { fs.unlinkSync(arq); } catch (e) { if (e.code !== 'ENOENT') throw e; } }

  async function trocar(slug, dados) {
    if (!dados || !dados.length) throw erro('A foto chegou vazia. Escolha a foto de novo.');
    if (dados.length > LIMITE_BYTES) throw erro('A foto precisa ter até 5 MB.', 413);
    const demuxer = tipoPelosBytes(dados);
    if (!demuxer) throw erro(ERRO_TIPO, 415);
    preparaPasta();
    const base = path.join(pasta, '.' + slug + '-' + crypto.randomBytes(6).toString('hex'));
    const entrada = base + '.in', saida = base + '.webp';
    try {
      fs.writeFileSync(entrada, dados, { mode: 0o600, flag: 'wx' });
      // Argumentos em lista (sem shell). O demuxer fixo impede o ffmpeg de adivinhar outro formato,
      // e max_pixels barra a imagem gigante feita para estourar a memória.
      await executar(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-max_pixels', String(40 * 1000 * 1000), '-f', demuxer, '-i', entrada,
        '-frames:v', '1', '-map_metadata', '-1',
        '-vf', `scale=${LADO}:${LADO}:force_original_aspect_ratio=increase,crop=${LADO}:${LADO}`,
        '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', '85', '-f', 'webp', '-threads', '1', saida],
      { timeout: timeoutMs, maxBuffer: 65536 });
      const feito = fs.readFileSync(saida);
      if (tipoPelosBytes(feito) !== 'webp_pipe') throw new Error('o ffmpeg não devolveu uma WebP');
      fs.chmodSync(saida, 0o600);
      fs.renameSync(saida, arqFoto(slug));
      apaga(arqSem(slug));
    } catch (e) {
      if (e.status) throw e;
      log('aviso', `Foto de ${slug}: o ffmpeg não conseguiu ler a imagem (${String(e.stderr || e.message).trim().slice(0, 200)}).`);
      throw erro('Não consegui abrir essa imagem. ' + ERRO_TIPO, 415);
    } finally { apaga(entrada); apaga(saida); }
    log('info', `Foto de ${slug} trocada pelo dono (${dados.length} bytes recebidos).`);
    return estado(slug);
  }

  function remover(slug) {
    preparaPasta();
    gravaAtomico(arqSem(slug), new Date().toISOString() + '\n');
    apaga(arqFoto(slug));
    log('info', `Foto de ${slug} removida pelo dono; a tela mostra a letra.`);
    return estado(slug);
  }

  function servir(req, res, slug) {
    let st;
    const arq = arqFoto(slug);
    try { st = fs.lstatSync(arq); } catch (_) { st = null; }
    if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('Sem foto trocada.'); }
    // A URL leva ?v=<versão>: a mesma URL é sempre a mesma foto.
    res.writeHead(200, {
      'Content-Type': 'image/webp', 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    if (req.method === 'HEAD') return res.end();
    const s = fs.createReadStream(arq);
    s.on('error', e => { log('erro', `Foto de ${slug}: falha lendo (${e.code || e.message}).`); res.destroy(); });
    s.pipe(res);
  }

  /** Rota /api/v1/agents/<slug>/avatar. Os ajudantes de HTTP e `agentePublico(a)` vêm do server.js. */
  async function tratar(req, res, url, sessao, { enviaJson, erroJson, lerCorpo, agentePublico }) {
    const ms = RX_ROTA_SONO.exec(url.pathname);
    if (ms) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { erroJson(res, 405, 'Use GET.'); return true; }
      if (!sessao || sessao.via === 'caixa') { erroJson(res, 403, 'Só o dono vê as fotos pelo navegador.'); return true; }
      let sl; try { sl = decodeURIComponent(ms[1]); } catch (_) { sl = ''; }
      if (!RX_SLUG.test(sl) || !registro.obter(sl)) { erroJson(res, 404, 'Não achei esse agente.'); return true; }
      servirSono(req, res, sl, ms[2]);
      return true;
    }
    const mm = RX_ROTA.exec(url.pathname);
    if (!mm) return false;
    const m = req.method;
    if (!sessao || sessao.via === 'caixa') { erroJson(res, 403, 'A foto do agente só é trocada pelo dono, no navegador.'); return true; }
    let slug;
    try { slug = decodeURIComponent(mm[1]); } catch (_) { slug = ''; }
    const a = RX_SLUG.test(slug) ? registro.obter(slug) : null;
    if (!a) { erroJson(res, 404, 'Não achei esse agente. Recarregue a página.'); return true; }
    if (m === 'GET' || m === 'HEAD') { servir(req, res, a.slug); return true; }
    try {
      if (m === 'PUT' || m === 'POST') {
        let dados;
        try { dados = await lerCorpo(req, LIMITE_BYTES); } catch (e) { throw e.status === 413 ? erro('A foto precisa ter até 5 MB.', 413) : e; }
        await trocar(a.slug, dados);
      } else if (m === 'DELETE') remover(a.slug);
      else { erroJson(res, 405, 'Use PUT com a foto para trocar, ou DELETE para tirar a foto.'); return true; }
      enviaJson(res, 200, { ok: true, agente: await agentePublico(a) });
    } catch (e) {
      if (!e.status) log('erro', `Foto de ${a.slug}: ${m} falhou (${e.code || e.message}).`);
      erroJson(res, e.status || 500, e.status ? e.message : 'Não consegui guardar a foto. Peça ao Admin para conferir o espaço e as permissões do servidor.');
    }
    return true;
  }

  return { estado, sono, trocar, remover, tratar };
}

module.exports = { criarAvatares, tipoPelosBytes, LIMITE_BYTES };
