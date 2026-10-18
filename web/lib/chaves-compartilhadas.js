'use strict';
// Chaves que servem a todos os agentes do dono (18/10/2026, pedido do dono): ao criar um agente, o
// formulário oferece copiar estas do cofre de um agente que já as tem, e a mensagem de boas-vindas só
// oferece conectar o que ainda falta. A cópia passa por cofre-agente.copiar: o valor não sai do host.

const COMPARTILHADAS = [
  { envName: 'GROQ_API_KEY', nome: 'Groq' },
  { envName: 'GEMINI_API_KEY', nome: 'Gemini' },
];

/** De qual agente cada chave compartilhável pode vir: [{ envName, nome, de, deNome }], só as que existem. */
function disponiveis(registro, cofre, excetoSlug) {
  const agentes = (registro.estado().agentes || []).filter((a) => a.tipo !== 'admin' && a.cofre_arquivo && a.slug !== excetoSlug);
  const saida = [];
  for (const k of COMPARTILHADAS) {
    const a = agentes.find((x) => cofre.ativas(x).some((c) => c.envName === k.envName));
    if (a) saida.push({ envName: k.envName, nome: k.nome, de: a.slug, deNome: a.nome || a.slug });
  }
  return saida;
}

/** Copia para `agente` as compartilháveis que ele não tem. Devolve os nomes copiados. Não reinicia. */
function copiarPara(registro, cofre, agente, quem) {
  const tem = new Set(cofre.ativas(agente).map((c) => c.envName));
  const copiadas = [];
  for (const d of disponiveis(registro, cofre, agente.slug)) {
    if (tem.has(d.envName)) continue;
    const r = cofre.copiar(registro.obter(d.de), agente, d.envName, quem);
    if (r && r.ok) copiadas.push(d.envName);
  }
  return copiadas;
}

/** As compartilháveis que o agente ainda não tem no cofre. */
function faltam(cofre, agente) {
  const tem = new Set(cofre.ativas(agente).map((c) => c.envName));
  return COMPARTILHADAS.filter((k) => !tem.has(k.envName)).map((k) => k.envName);
}

module.exports = { COMPARTILHADAS, disponiveis, copiarPara, faltam };
