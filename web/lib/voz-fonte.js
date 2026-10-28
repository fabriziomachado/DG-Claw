'use strict';
// De onde sai a voz de cada agente (27/10/2026, pedido do dono): 'navegador' (a voz do próprio aparelho,
// grátis: Microsoft no Edge, Google no Chrome, a do sistema no celular) ou 'elevenlabs' (a voz própria do
// agente, que gasta a cota). Padrão: navegador. Arquivo em <dados>/voz/fontes.json (modo 600).

const fs = require('node:fs');
const path = require('node:path');
const { gravaArquivoSeguro } = require('./grava-seguro');

const FONTES = ['navegador', 'elevenlabs'];

function criarVozFonte({ arquivo, log }) {
  const pasta = path.dirname(arquivo);
  let dados = null; // { <slug>: 'navegador' | 'elevenlabs' }

  function carrega() {
    if (dados) return dados;
    let bruto;
    try { bruto = fs.readFileSync(arquivo, 'utf8'); } catch (e) {
      if (e.code !== 'ENOENT') log('erro', `Não consegui ler ${arquivo} (${e.code || e.message}). Todos os agentes usam a voz do aparelho até isso ser resolvido.`);
      return e.code === 'ENOENT' ? (dados = {}) : {};
    }
    try {
      const j = JSON.parse(bruto);
      const novo = {};
      for (const [slug, f] of Object.entries((j && j.agentes) || {})) if (FONTES.includes(f)) novo[slug] = f;
      dados = novo;
    } catch (e) {
      log('erro', `O arquivo ${arquivo} está ilegível (${e.message}). Todos os agentes usam a voz do aparelho; conserte ou renomeie o arquivo.`);
      return {};
    }
    return dados;
  }

  /** A escolha guardada para o agente (sem olhar se a ElevenLabs está disponível). */
  function de(slug) {
    const d = carrega();
    return Object.hasOwn(d, slug) ? d[slug] : 'navegador';
  }

  function grava(slug, fonte) {
    if (!FONTES.includes(fonte)) {
      const e = new Error(`A voz "${String(fonte).slice(0, 40)}" não existe. As que existem: ${FONTES.join(', ')}.`); e.status = 400; throw e;
    }
    const copia = { ...carrega(), [slug]: fonte };
    try {
      fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
      gravaArquivoSeguro(arquivo, `${JSON.stringify({ versao: 1, agentes: copia }, null, 2)}\n`, { raiz: pasta, modo: 0o600 });
    } catch (e) {
      const err = new Error(`Não consegui gravar ${arquivo} (${e.message}). A voz não mudou.`); err.status = 503; log('erro', err.message); throw err;
    }
    dados = copia;
    return fonte;
  }

  return { de, grava };
}

module.exports = { criarVozFonte, FONTES };
