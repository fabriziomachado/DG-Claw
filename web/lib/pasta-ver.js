'use strict';
// Pasta do agente com a cara da conversa (25/10/2026, pedido do dono): a aba Pasta abre o arquivo na
// tela /ver-arquivo, que usa o mesmo formatador (formatador.js) e, para .html, a mesma caixa isolada
// do visual da conversa (/api/v1/media/<id>/visual). Aqui só se confere o caminho: ele precisa ficar
// dentro de <casa do agente>/arquivos (a raiz da aba Pasta), com o link simbólico já seguido.

const fs = require('node:fs');
const path = require('node:path');

const dentro = (raiz, alvo) => alvo === raiz || alvo.startsWith(raiz + path.sep);

/** Caminho real do arquivo pedido (relativo à Pasta) ou { status, erro }. */
function arquivoDaPasta(homeHost, rel) {
  const r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!r || r.length > 1000 || r.includes('\0')) return { status: 400, erro: 'Diga qual arquivo da Pasta abrir (parâmetro "caminho").' };
  if (r.split('/').some(s => s === '' || s === '..' || s.startsWith('.'))) return { status: 400, erro: `O caminho "${r.slice(0, 80)}" não vale: sem "..", sem pasta escondida.` };
  if (!homeHost) return { status: 503, erro: 'Este agente não tem a casa registrada, então não há Pasta para abrir.' };
  const raiz = path.join(homeHost, 'arquivos');
  let raizReal, real;
  try { raizReal = fs.realpathSync(raiz); } catch (_) { return { status: 404, erro: 'Este agente ainda não tem nada na Pasta.' }; }
  try { real = fs.realpathSync(path.join(raiz, r)); } catch (_) { return { status: 404, erro: `Não achei "${r.slice(0, 80)}" na Pasta. Pode ter sido apagado ou movido.` }; }
  if (!dentro(raizReal, real)) return { status: 403, erro: `"${r.slice(0, 80)}" aponta para fora da Pasta e não abre aqui.` };
  try { if (!fs.statSync(real).isFile()) return { status: 400, erro: `"${r.slice(0, 80)}" é uma pasta, não um arquivo.` }; } catch (e) { return { status: 404, erro: `Não consegui ler "${r.slice(0, 80)}" (${e.code || e.message}).` }; }
  return { real, nome: path.basename(r) };
}

const TETO_IMAGEM = 5 * 1024 * 1024;
/** Lê uma imagem comum (JPG, PNG, GIF, WEBP pelos primeiros bytes) até 5 MB, ou { status, erro }. */
function imagemDaPasta(real) {
  let dados;
  try {
    if (fs.statSync(real).size > TETO_IMAGEM) return { status: 413, erro: 'Imagem acima de 5 MB: diminua antes de pôr no painel.' };
    dados = fs.readFileSync(real);
  } catch (e) { return { status: 404, erro: `Não consegui ler a imagem (${e.code || e.message}).` }; }
  const b = dados;
  const mime = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
    : b.length > 8 && b.readUInt32BE(0) === 0x89504e47 ? 'image/png'
    : b.subarray(0, 4).toString('latin1') === 'GIF8' ? 'image/gif'
    : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : '';
  if (!mime) return { status: 415, erro: 'Não é uma imagem JPG, PNG, GIF ou WEBP.' };
  return { mime, dados };
}

module.exports = { arquivoDaPasta, imagemDaPasta };
