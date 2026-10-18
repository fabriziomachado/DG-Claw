---
name: ui-generativa
description: Responde dados com componentes desenhados pela própria conversa (KPI, tabela e gráfico de barras, colunas, linhas ou pizza) mandando um bloco ```dgui com JSON, em vez de texto corrido ou tabela em Markdown. Usada sempre que a resposta tem números, indicadores, ranking, comparação entre itens, evolução no tempo ou uma lista com colunas, e quando o dono diz "me mostra", "num gráfico", "faz um painel", "dashboard", "KPI", "tabela", "compara".
user-invocable: true
---

# UI generativa na conversa

Eu não desenho a tela: mando os **dados** num bloco ```dgui e a conversa do DG Claw desenha os
componentes prontos, no visual do sistema, no tema claro e no escuro, no celular e no computador.
É mais rápido e mais bonito que montar um visual em HTML (a skill `visuais-na-conversa` fica para
o que é livre: animação, layout próprio, botões de escolha).

## Quando usar

- Um número que importa (total, taxa, custo, prazo) → **KPI**.
- Comparar itens (cursos, produtos, pessoas) → **gráfico de barras**.
- Evolução no tempo (meses, anos) → **gráfico de linhas** (ou **colunas** com poucos períodos).
- Partes de um todo (até 6 fatias) → **pizza**.
- Detalhe para consultar, com várias colunas → **tabela** (ordena ao tocar no título).
- Vários juntos (o caso comum) → **painel** com KPIs no topo, gráfico e tabela.

Não use para resposta curta ou conversa solta. Nunca mande tabela em Markdown (`| a | b |`) quando
couber um ```dgui.

## Como mandar

Na resposta pelo `reply` do DG Chat, escreva **uma frase dizendo o que o painel mostra**, depois o
bloco e, se quiser, uma pergunta de seguimento:

````
Aqui está a evasão por curso em 2024:

```dgui
{"tipo":"painel","titulo":"Evasão por curso · 2024","fonte":"Power BI · DB_Evasão","atualizado":"22/07/2025","itens":[
  {"tipo":"kpi","titulo":"Evasão geral","valor":"10,8%","variacao":"-1,2 p.p. vs 2023","tendencia":"baixa","bom":"baixa"},
  {"tipo":"kpi","titulo":"Maior taxa (ADS EAD)","valor":"65,3%","variacao":"+4,1 p.p.","tendencia":"alta","bom":"baixa"},
  {"tipo":"grafico","forma":"barras","titulo":"Taxa de evasão (%)","unidade":"%",
   "categorias":["ADS (EAD)","Administração (EAD)","Ciências Contábeis (EAD)"],
   "series":[{"nome":"2024","valores":[65.3,58.6,49.0]}]},
  {"tipo":"tabela","titulo":"Cursos com mais evadidos","colunas":["Curso","Evadidos","Matrículas","%"],
   "linhas":[["Direito",206,2762,"7,5%"],["Psicologia",144,1694,"8,5%"]]}
],
"sugestoes":["Interprete o gráfico","Sugira ações de retenção para os cursos EAD","Compare com 2023"]}
```

Quer que eu detalhe algum curso?
````

A frase antes do bloco é obrigatória: no Telegram e no WhatsApp o bloco não é desenhado, e a frase
é o que a pessoa lê lá.

## Componentes

| tipo | campos | observações |
|---|---|---|
| `kpi` | `titulo`, `valor` (texto já formatado, ex. `"65,3%"`, `"R$ 12,7 mil"`), `variacao`, `tendencia` (`alta`, `baixa`, `neutra`), `bom` (`alta` ou `baixa`: qual direção é boa), `legenda` | KPIs seguidos ficam lado a lado. Evasão, custo, atraso: `"bom":"baixa"` (subir fica vermelho). |
| `tabela` | `titulo`, `colunas` (textos, ou `{"nome","alinha":"direita|centro"}`), `linhas` (lista de listas), `ordenavel` (padrão `true`) | Números alinham à direita sozinhos. Até 300 linhas. |
| `grafico` | `forma` (`barras`, `colunas`, `linhas`, `pizza`), `titulo`, `unidade` (`"%"`, `"R$"`, `"alunos"`), `categorias`, `series` (`[{"nome","valores":[...]}]`) | Até 6 séries e 80 categorias. Pizza usa só a primeira série. |
| `painel` | `titulo`, `itens` (lista de componentes), `fonte`, `atualizado`, `sugestoes` | Um painel por resposta costuma bastar. |

## Fonte e perguntas sugeridas

- `fonte` e `atualizado` (no painel ou em cada componente) aparecem discretos no rodapé e saem na
  imagem que o dono baixa. Sempre que souber de onde vêm os dados, preencha.
- `sugestoes` (sempre que houver gráfico ou tabela): 3 a 4 perguntas curtas que o dono provavelmente faria a seguir, pensadas para
  **estes** dados (interpretar, explicar uma anomalia, sugerir ação, comparar com outro período,
  detalhar um item). Viram botões embaixo do painel; um toque manda a pergunta para mim, como se
  ele tivesse digitado. Escreva na voz do dono ("Sugira ações de retenção para os cursos EAD").
  Se eu não mandar, a conversa coloca perguntas genéricas no lugar; as minhas, específicas, são melhores.
- Cada gráfico e tabela já ganha sozinho os botões de baixar (PNG ou CSV), copiar, compartilhar
  e ampliar: não preciso fazer nada para isso.

## Regras do JSON

- JSON válido: aspas duplas, sem vírgula sobrando, sem comentário. Se ele não abrir, a conversa
  mostra "Não consegui desenhar" com o bloco cru, e eu corrijo e mando de novo.
- Em `valores`, **números de verdade** (`65.3`, não `"65,3%"`); a unidade vai em `unidade`.
- Em `kpi.valor` e nas células da tabela, texto já no formato brasileiro (`"2.762"`, `"7,5%"`).
- Nomes curtos nas categorias (abrevie: "ADS (EAD)"); o nome inteiro pode ir na tabela.
- Diga de onde vêm os dados na frase (fonte, período), como faria num relatório.
