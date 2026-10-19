'use strict';
// 👍 / 👎 nas respostas do agente (19/10/2026, ideia 5 do plano a partir do filament-chat).
// POST /api/v1/agents/<slug>/feedback {mensagem, tipo: "bom"|"ruim"}: o Web confere que a mensagem é do
// agente, guarda a escolha (para a tela lembrar em qualquer aparelho) e entrega ao agente um
// <plataforma recado="feedback"> (some da tela). 👍: ele guarda na memória o que funcionou, sem responder.
// 👎: ele pergunta ao dono, curto, o que melhorar. Repetir o mesmo toque não manda de novo; trocar manda.

const fs = require('node:fs');
const path = require('node:path');

function criarFeedback({ config, conversa, log = () => {} }) {
  const pasta = path.join(config.dataDir, 'feedback');
  const cache = new Map();
  const arq = (slug) => path.join(pasta, `${slug}.json`);
  function ler(slug) {
    if (cache.has(slug)) return cache.get(slug);
    let d = {};
    try { d = JSON.parse(fs.readFileSync(arq(slug), 'utf8')).votos || {}; } catch (e) { if (e.code !== 'ENOENT') log('aviso', `Feedback de ${slug} ilegível (${e.message}).`); }
    cache.set(slug, d);
    return d;
  }
  function grava(slug, votos) {
    const chaves = Object.keys(votos);
    if (chaves.length > 2000) for (const k of chaves.slice(0, chaves.length - 2000)) delete votos[k];
    fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
    const tmp = `${arq(slug)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ votos }), { mode: 0o600 });
    fs.renameSync(tmp, arq(slug));
    cache.set(slug, votos);
  }
  const votos = (slug) => ler(slug);

  async function votar(agente, thread, { mensagem, tipo }) {
    if (!['bom', 'ruim', ''].includes(tipo)) return { status: 400, corpo: { ok: false, erro: 'tipo precisa ser "bom", "ruim" ou "" (tirar).' } };
    const m = thread.msgs.find((x) => x.id === mensagem && x.origin === 'agente');
    if (!m) return { status: 404, corpo: { ok: false, erro: 'Não achei essa resposta do agente.' } };
    const v = Object.assign({}, ler(agente.slug));
    const antes = v[mensagem] || '';
    if (tipo) v[mensagem] = tipo; else delete v[mensagem];
    grava(agente.slug, v);
    if (!tipo || tipo === antes) return { status: 200, corpo: { ok: true, tipo } };
    const trecho = String(m.text || '').replace(/```[\s\S]*?```/g, '[bloco]').replace(/\s+/g, ' ').trim().slice(0, 600);
    const chat = agente.chat_id || 'c_' + agente.slug;
    const recado = tipo === 'bom'
      ? `<plataforma recado="feedback" tipo="bom">O dono marcou 👍 nesta resposta sua: "${trecho}". Guarde na memória (MEMORY.md, regras aprendidas) em uma linha o que funcionou nela (formato, nível de detalhe, abordagem), para repetir. Não responda nada no chat.</plataforma>`
      : `<plataforma recado="feedback" tipo="ruim">O dono marcou 👎 nesta resposta sua: "${trecho}". Pergunte a ele, numa frase curta pelo mcp__dgchat__reply no chat ${chat}, o que ficou ruim, e quando ele responder guarde a lição na memória.</plataforma>`;
    try { await conversa.entregar(agente, recado, { cru: true }); } catch (e) { log('aviso', `Feedback ${agente.slug}: não entreguei o recado (${e.message}).`); }
    return { status: 200, corpo: { ok: true, tipo } };
  }
  return { votar, votos };
}

module.exports = { criarFeedback };
