---
name: ux-ui
description: Guia de UX/UI do DG Claw para desenhar qualquer coisa que o dono vê (visual, painel, mockup, página, cartão, proposta de tela). Use antes de montar HTML, um bloco dgui com visual, um vis-*.html ou imagens de proposta. Cores da paleta, ícones de traço, estilo clean e discreto.
---

# UX/UI do DG Claw

O dono gosta de interface **clean, discreta e refinada**, no estilo do ChatGPT. Tudo o que você
desenhar (visual na conversa, painel, página, mockup de proposta) segue este guia, para parecer parte
do mesmo sistema.

## Princípios

1. **Menos é mais.** Uma ideia por tela. Tire bordas, sombras e enfeites que não ajudam a ler.
2. **Ação secundária é ícone, não botão com texto.** Copiar, baixar, ampliar, atualizar, compartilhar:
   ícone pequeno de traço (16 a 18 px), cinza (`--dg-texto-2`/`-3`), com `title` e `aria-label`.
   Botão com texto só para a ação principal da tela, e no máximo um destacado.
3. **Discreto por padrão, forte quando importa.** Estado normal em cinza; o selecionado ou ativo fica
   um pouco mais forte (cor do texto, `font-weight:600`, fundo `--dg-superficie-2`), nunca colorido
   berrante.
4. **Sem emoji na interface.** Emoji só dentro do texto de uma mensagem, se fizer sentido. Rótulos,
   botões, títulos e listas usam os ícones de traço abaixo.
5. **Funciona nos dois temas e no celular.** Só cores da paleta (nada de `#fff` ou `#000` soltos). Desenhe
   primeiro para 390 px de largura; toque com no mínimo 32 px de área.
6. **Texto em português do Brasil natural.** Sem travessão no meio da frase. Rótulos curtos ("Avisar",
   "Pedir", "Atualizar agora"). Números no formato brasileiro (1.284; 10,8%; R$ 2,3 mi).
7. **Proposta antes de construir.** Mudança visual grande vira imagens para o dono aprovar, uma por
   tela/variante, mandadas uma seguida da outra (a conversa junta em carrossel). Cada imagem com uma
   legenda curta do que mostra.

8. **Comando ou texto para copiar fica na mensagem, nunca num visual.** Um trecho: bloco de código com a
   linguagem (```bash). Vários em etapas: o componente `passos` do bloco dgui. O bloco de código da conversa
   já tem a barra com a língua, o Copiar e as cores de sintaxe.

## Paleta (variáveis do tema.css)

| Uso | Variável |
| --- | --- |
| fundo da página | `--dg-fundo` |
| cartões, menus, campo de digitar | `--dg-superficie` |
| hover, chips, código, selecionado | `--dg-superficie-2` |
| bordas e divisórias (1 px) | `--dg-borda` |
| texto principal / secundário / discreto | `--dg-texto` / `--dg-texto-2` / `--dg-texto-3` |
| ação principal, link, foco | `--dg-azul` (`--dg-azul-forte` para texto azul) |
| balão do dono | `--dg-balao-dono` |
| sucesso / entrega | `--dg-entrega-fundo`, `-borda`, `-texto` |
| decisão pendente | `--dg-pedido-fundo`, `-borda`, `-texto` |
| erro | `--dg-erro-fundo`, `-borda`, `-texto` |
| séries de gráfico | `--dg-serie-0` a `--dg-serie-5` |
| sombra leve de flutuante | `--dg-sombra` |

Num HTML seu (vis-*.html ou página), copie as variáveis do bloco `:root` e do `html[data-tema="escuro"]`
de `/opt/dgclaw/app/web/public/tema.css`, ou defina as mesmas com `@media (prefers-color-scheme:dark)`.

## Tipografia e espaço

- Fonte do sistema: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`.
- Corpo 14,5 a 15 px; secundário 12,5 a 13 px; rótulo pequeno em maiúsculas 11 a 12 px, `letter-spacing:.06em`,
  peso 700, cor `--dg-texto-3`. Títulos 15 a 18 px, peso 600 a 650.
- Raio: cartões 12 a 16 px; chips e pílulas 999 px; botões de ícone redondos.
- Espaços em múltiplos de 4 (4, 8, 12, 16, 24). Cartão com padding 10 a 14 px.
- Borda de 1 px `--dg-borda` no lugar de sombra; sombra (`--dg-sombra`) só no que flutua (menu, balão).

## Ícones de traço

Sempre: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.8"`,
`stroke-linecap="round"`, `stroke-linejoin="round"`, tamanho 16 a 18 px. A cor vem do texto em volta.
Os do sistema estão em `references/icones.md`: use estes antes de inventar outro.

## Componentes prontos (prefira a desenhar do zero)

- **Números, gráficos, tabelas, painéis, filtros, painel vivo, carrossel:** bloco ```dgui (skill
  `ui-generativa`). Já seguem este guia e ganham baixar, copiar, ampliar e tocar no ponto.
- **Decisão do dono:** cartão de escolha (`{"tipo":"escolha"}`), com a recomendada marcada.
- **Texto para copiar** (comando, prompt, mensagem pronta, configuração, link): bloco de código na
  própria mensagem, com a língua (```bash, ```sql, ```text). O chat desenha a barra com a língua e o
  Copiar. Passo a passo com comandos: componente `passos` do ```dgui. **Nunca** caixinha de copiar
  (textarea + botão) dentro de um visual: é o estilo antigo e foge do design do app.
- **Visual livre (animação, layout próprio):** skill `visuais-na-conversa`, seguindo este guia.

## Checklist antes de mandar

- [ ] Só variáveis da paleta; confere no claro e no escuro.
- [ ] Ações secundárias como ícone de traço, com `title`.
- [ ] Nenhum emoji em rótulo, botão ou título.
- [ ] Cabe em 390 px sem rolar para o lado.
- [ ] Um só destaque por tela; o resto em cinza.
- [ ] Texto curto, sem travessão, números no formato brasileiro.
