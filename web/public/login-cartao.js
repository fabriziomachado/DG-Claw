'use strict';
/* login-cartao.js: a parte pura do cartão "Conectar o seu Claude/Codex" da conversa.

   Sem DOM e sem rede: decide qual provedor o cartão mostra, se o texto digitado é o
   comando /login e o que o cartão exibe em cada estado do login. O desenho e as chamadas
   ficam em conversa.js; aqui fica o que se pode testar com node:test (web/test/login-cartao.test.js). */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.DGLoginCartao = m;
})(this, function () {
  /** "/login" sozinho, sem diferenciar maiúsculas nem espaços nas pontas. */
  function ehComandoLogin(texto) {
    return typeof texto === 'string' && texto.trim().toLowerCase() === '/login';
  }

  /** O nome que a pessoa conhece: Codex ou Claude (qualquer outra coisa cai em Claude). */
  function nomeProvedor(provedor) {
    return /codex/i.test(String(provedor || '')) ? 'Codex' : 'Claude';
  }

  /** Só abre em nova aba um link https: o texto vem de um programa que repassa o que o provedor mandou. */
  function linkSeguro(u) {
    return typeof u === 'string' && /^https:\/\//i.test(u) ? u : null;
  }

  /**
   * O que o cartão mostra. `d` é a resposta de GET .../login (estado, link, codigoDispositivo,
   * mensagem, provedor, conferido, precisa_login). `ctx.iniciado` diz se o login foi começado
   * por este cartão (ou visto em andamento): um "concluido" ou "falhou" que sobrou de antes não deve aparecer como novidade.
   * `ctx.abriuLink`: a pessoa já tocou em "Abrir a página de login" (o passo vai para o código).
   * `ctx.vencido`: o login existia e venceu (o texto do começo muda).
   *
   * Passo a passo (20/10/2026, pedido do dono): `etapas` são os três passos e `passo` o atual
   * (0 abrir, 1 entrar, 2 colar o código; 3 = tudo pronto).
   *
   * fase: inicio | ja_conectado | preparando | abrir | codigo | navegador | concluido | falhou
   */
  function visao(d, ctx) {
    d = d || {};
    const iniciado = !!(ctx && ctx.iniciado);
    const abriu = !!(ctx && ctx.abriuLink);
    const nome = nomeProvedor(d.provedor);
    const agente = (ctx && ctx.agente) || 'O agente';
    const codex = nome === 'Codex';
    let estado = d.estado || 'nenhum';
    if ((estado === 'concluido' || estado === 'falhou') && !iniciado) estado = 'nenhum';
    const base = {
      fase: 'inicio', provedor: nome, titulo: 'Conectar ' + (agente === 'O agente' ? 'o seu ' + nome : agente + ' ao seu ' + nome),
      sub: '', texto: '', passos: [], etapas: ['Abrir', 'Entrar', codex ? 'Digitar o código' : 'Colar o código'], passo: 0,
      botao: null, link: null, campoCodigo: false, codigoDispositivo: null, reabrir: false,
      cancelar: false, fechar: false, entrarDeNovo: false, aviso: '',
    };
    switch (estado) {
      case 'aguardando_link':
        return Object.assign(base, { fase: 'preparando', sub: 'Preparando a página de login…', texto: 'Preparando o link…', cancelar: true, aviso: 'Preparando o link de login' });
      case 'aguardando_codigo':
        if (!abriu) {
          return Object.assign(base, {
            fase: 'abrir', sub: 'A página de login está pronta.', link: linkSeguro(d.link), cancelar: true,
            texto: 'Abra a página numa aba nova e entre com a mesma conta de sempre.',
            passos: ['Abra a página de login e entre com a sua conta.', 'No fim, a página mostra um código. Cole ele aqui embaixo.'],
            aviso: 'A página de login está pronta',
          });
        }
        return Object.assign(base, {
          fase: 'codigo', sub: 'Falta só o código.', passo: 2, link: linkSeguro(d.link), campoCodigo: true, cancelar: true, reabrir: true,
          texto: 'No fim do login, a página mostra um código. Copie e cole aqui.',
          passos: ['Abra a página de login e entre com a sua conta.', 'No fim, a página mostra um código. Cole ele aqui embaixo.'],
          aviso: 'Falta colar o código que a página mostrou',
        });
      case 'aguardando_navegador':
        return Object.assign(base, {
          fase: 'navegador', sub: abriu ? 'Falta digitar o código na página.' : 'A página de login está pronta.', passo: abriu ? 2 : 0,
          link: linkSeguro(d.link), codigoDispositivo: d.codigoDispositivo || null, cancelar: true, reabrir: abriu,
          texto: abriu ? 'Quando a página pedir, digite este código. Aqui conecta sozinho.' : 'Abra a página numa aba nova e entre com a sua conta.',
          passos: ['Abra a página de login e entre com a sua conta.', 'Quando a página pedir, digite o código abaixo.'],
          aviso: 'Esperando você terminar o login na página',
        });
      case 'concluido':
        return Object.assign(base, { fase: 'concluido', titulo: 'Conectado.', passo: 3, sub: agente + ' já pode responder.', texto: 'Tudo certo. ' + agente + ' já pode responder.', aviso: 'Conectado' });
      case 'falhou':
        return Object.assign(base, {
          fase: 'falhou', titulo: 'O login não deu certo',
          sub: 'Pode tentar de novo, leva um minuto.',
          texto: d.mensagem ? String(d.mensagem) : 'O login terminou sem conectar a conta.',
          botao: 'Tentar de novo', fechar: true, aviso: 'O login falhou',
        });
      default: {
        const jaOk = !!(d.conferido && d.conferido.ok === true) && !d.precisa_login;
        if (jaOk) {
          return Object.assign(base, {
            fase: 'ja_conectado', titulo: 'Esta conta já está conectada', passo: 3,
            sub: agente + ' já usa a sua conta do ' + nome + '.',
            texto: agente + ' já usa a sua conta do ' + nome + '. Só entre de novo se quiser trocar de conta.',
            fechar: true, entrarDeNovo: true,
          });
        }
        return Object.assign(base, {
          sub: ctx && ctx.vencido ? 'O login venceu. Leva um minuto, sem terminal.' : 'Precisa da sua conta para responder. Leva um minuto, sem terminal.',
          texto: agente + ' precisa da sua conta do ' + nome + ' para responder. Conecte aqui, sem terminal.',
          botao: 'Conectar', fechar: true,
        });
      }
    }
  }

  return { ehComandoLogin, nomeProvedor, linkSeguro, visao };
});
