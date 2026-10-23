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
| `leitura` | `titulo` (padrão "Leitura do especialista"), `destaques` (3 frases curtas, ou `{"tipo":"alerta|queda|alta|ideia|ok","texto"}`), `detalhe` (texto com `**negrito**`, parágrafos e itens `- `) | A interpretação dos dados. Os destaques ficam à vista; o detalhe abre em "Ver análise completa". |
| `escolha` | `pergunta`, `opcoes` (textos, ou `{"texto","detalhe","recomendada":true}`) | Para uma decisão do dono (junto do `[PEDIDO]`): lista A, B, C para tocar e "Outra resposta". A opção tocada chega como a resposta dele. |
| `painel` | `titulo`, `itens` (lista de componentes), `fonte`, `atualizado`, `sugestoes` | Um painel por resposta costuma bastar. |

## Interpretação: no componente `leitura`, não em textão

Quando eu explico os números (diagnóstico, hipóteses, ressalvas), isso vai num `leitura` como último
item do painel, e não em parágrafos soltos depois do bloco. Três destaques de uma linha cada, do mais
importante para o menos, e o resto no `detalhe`. Fora do bloco fica só a frase-resumo antes dele.

## Fonte e perguntas sugeridas

- `fonte` e `atualizado` (no painel ou em cada componente) aparecem discretos no rodapé e saem na
  imagem que o dono baixa. Sempre que souber de onde vêm os dados, preencha.
- `sugestoes` (sempre que houver gráfico ou tabela): 3 a 4 perguntas curtas que o dono provavelmente faria a seguir, pensadas para
  **estes** dados (interpretar, explicar uma anomalia, sugerir ação, comparar com outro período,
  detalhar um item). Viram botões embaixo do painel; um toque manda a pergunta para mim, como se
  ele tivesse digitado. Escreva na voz do dono ("Sugira ações de retenção para os cursos EAD").
  Se o dono não quiser as sugestões num painel (comum em app fixo), use `"sugestoes": false`.
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

## Interatividade que a tela já dá (18/10/2026)

Sem fazer nada a mais: tocar numa barra, coluna, ponto ou fatia mostra o valor e um "Perguntar
sobre este" (chega a mim como pergunta); tocar numa série da legenda esconde ou mostra a série;
a tabela ordena ao tocar no título. Por isso, nos gráficos, use nomes de categoria que façam
sentido sozinhos numa pergunta ("Diploma MEC v1.05", não "Item 1").

## Filtros no painel

Quando o dono vai querer olhar o mesmo painel por ano, área, curso etc., mande os dados já
separados e deixe a tela trocar na hora, sem me perguntar de novo:

```json
{"tipo":"painel","titulo":"Portfólio PMO",
 "filtros":[{"nome":"Ano","opcoes":["2024","2025"],"padrao":"2025"},
            {"nome":"Área","opcoes":["Todas","Proen","Proad"]}],
 "variantes":{
   "2025|Todas":[ ...itens do painel (kpi, grafico, tabela)... ],
   "2025|Proen":[ ... ], "2024|Todas":[ ... ]
 },
 "fonte":"Power BI · bi-kanbanize3","atualizado":"09/10/2026"}
```

- A chave de `variantes` é a opção de cada filtro, na ordem dos filtros, unida por `|`.
- Até 3 filtros. Até 5 opções viram botõezinhos; mais que isso, uma lista.
- Combinação que faltar aparece como "Sem dados para ...": mande todas as que fizerem sentido.
- Cuidado com o tamanho: cada variante é um painel inteiro. Se passar de umas 30 combinações,
  prefira um filtro só.

## Painel que se atualiza sozinho

Para números que mudam ao longo do dia (chamados, filas, vendas), o painel pode se atualizar:

1. Crie `~/.dgclaw/paineis/<id>.sh` (bash) ou `<id>.py` (python3) que **imprime** o painel
   atualizado (o mesmo JSON do bloco dgui, `"tipo":"painel"`) e nada mais na saída padrão.
   `<id>`: minúsculas, números e hífen, até 40 caracteres. O script roda na sua caixa, como você,
   com até 180 s; chaves vêm do ambiente, como sempre.
2. Rode o script uma vez e confira que a saída é um JSON válido.
3. Mande o painel com `"vivo":{"id":"<id>","a_cada_min":15}`.

A tela mostra "atualizado há X min" e um ícone de atualizar; quando passa do intervalo e o dono
está olhando, ela roda o script de novo e redesenha. Escolha o intervalo pelo custo da consulta
(respeite limites de API, como os 60 por minuto do SoftDesk) e não use isso para dado que muda
uma vez por mês.

## Carrossel: variantes, propostas e cenários

Quando a resposta é "aqui estão N opções" (layouts, cenários, versões de um painel), mande um
carrossel em vez de tudo empilhado. Um cartão por opção; no celular desliza com o dedo.

```json
{"tipo":"carrossel","titulo":"Qual layout do relatório?","escolher":true,
 "itens":[
   {"titulo":"Compacto","detalhe":"Só os KPIs e um gráfico","conteudo":[{"tipo":"kpi","titulo":"Evasão","valor":"10,8%"}]},
   {"titulo":"Completo","detalhe":"KPIs, gráfico e tabela","recomendada":true,"conteudo":{"tipo":"grafico","forma":"colunas","categorias":["2023","2024"],"series":[{"nome":"Evasão","valores":[12,11]}]}},
   {"titulo":"Só tabela","detalhe":"Para exportar"}
 ]}
```

- `conteudo`: um componente (kpi, grafico, tabela) ou uma lista deles. Pode ficar sem: o cartão
  mostra só título e detalhe.
- `escolher: true` põe "Escolher esta" em cada cartão; o toque chega a você como
  "Escolho: <titulo>". Marque a sua sugestão com `"recomendada": true`.
- Até 12 cartões. `imagem` só aceita endereço do próprio DG Claw (começando com `/`).
- Imagens (prints, fotos, propostas desenhadas): mande cada uma com `send_file`, uma seguida da
  outra, cada uma com a sua legenda. A conversa junta imagens seguidas num carrossel sozinha.

## Passos (passo a passo com comandos)

Instrução com etapas, cada uma com um comando ou trecho para copiar, vai num bloco `passos` na
própria mensagem (nunca num visual com caixinha). A conversa numera, liga os passos com uma linha
fina e mostra cada código no bloco padrão (língua no topo, Copiar, cores de sintaxe).

```json
{"tipo":"passos","itens":[
  {"titulo":"Crie o usuário só de túnel","texto":"Sem senha e sem shell.","codigo":"sudo adduser --disabled-password dgclaw-tunel","lingua":"bash"},
  {"titulo":"Teste o túnel","texto":"Num terminal abra o túnel; no outro, conecte.","codigo":"ssh -N -L 3307:10.0.0.5:3306 dgclaw-tunel@servidor","lingua":"bash"}
]}
```

- `codigo` e `lingua` são opcionais (passo só de texto também vale). Quebras de linha no código como `\n`.
- Um comando solto, sem etapas: bloco de código comum na mensagem (```bash ... ```).
