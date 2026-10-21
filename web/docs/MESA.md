# Mesa de tarefas

A Mesa mostra ao dono, numa tela só, o que cada agente está fazendo: quem está em quê,
quanto falta, o que travou e o que está esperando por ele. Fica em `/mesa` no DG Claw Web.

**Quem cria, atualiza e conclui as tarefas é o próprio agente**, pelo comando `dgclaw-mesa`
(ou pela API crua, com `dgclaw-api`). O dono acompanha pela tela e também pode mexer: criar
uma tarefa para um agente, responder o que ele perguntou, concluir, cancelar ou reabrir.
Tudo o que a tela faz passa por esta mesma API.

Funciona sozinha em cada VPS, sem nenhum serviço de fora. A verdade fica no Web, em
`<DGCLAW_WEB_DATA>/mesa/tarefas.json`.

## Quando criar uma tarefa (a regra dos agentes)

1. **Pedido rápido não vira tarefa.** Responder, mandar um arquivo, conferir algo em dois
   minutos: só faça.
2. **Trabalho de verdade vira tarefa ANTES de começar.** Conteúdo, desenvolvimento,
   projeto, levantamento de várias etapas. Delegou a outra sessão? A tarefa continua sua.
3. **Na dúvida, pergunte ao dono:** "quer que eu acompanhe isso na mesa?".
4. **Atualize enquanto trabalha:** `progresso`, `passos` ou `nota`. Tarefa em `fazendo` sem
   nenhuma atualização há **45 minutos** aparece como **"parada?"**.
5. **Travou ou precisa do dono? Diga.** `travada` e `esperando_dono` exigem `motivo` e vão
   para o topo da mesa. `esperando_dono` também avisa o aparelho do dono (notificação).
6. **O dono respondeu na conversa?** Atualize a tarefa no mesmo turno: tire do `motivo` o que
   ele já respondeu; se nada mais depende dele, volte a `fazendo` e registre a resposta em
   `nota`. Autorizar a execução não é o mesmo que concluir.
7. **Terminou, conclua**, com `link` quando houver. A concluída fica na mesa, apagada com ✓,
   até o fim do dia.

## A tarefa

```json
{
  "id": 12,
  "agente": "luna",
  "titulo": "Roteiro do reels de janela de contexto",
  "origem": "Dono, 05/10 15h42: faz o roteiro do reels de janela de contexto",
  "tipo": "conteudo",
  "estado": "fazendo",
  "aberta": true,
  "parada": false,
  "progresso": 50,
  "progresso_origem": "passos",
  "motivo": null,
  "nota": "escrevendo o gancho",
  "passos": [{"texto": "pesquisa", "feito": true}, {"texto": "roteiro", "feito": false}],
  "link": "https://...",
  "anexos": [{"rotulo": "Planilha", "url": "https://..."}],
  "versao": "7",
  "criada_por": "agente luna",
  "criada_em": "2026-10-05T15:45:00-03:00",
  "atualizada_em": "2026-10-05T16:10:00-03:00",
  "atualizada_em_epoch": 1791230000.123,
  "concluida_em": null,
  "atualizada_ha_min": 3
}
```

| Campo | O que é |
| --- | --- |
| `agente` | slug do agente que faz (o `id` de `GET /api/v1/agents`). Não muda depois de criada |
| `titulo` | até 120 caracteres. Obrigatório |
| `origem` | o pedido em uma linha, **com a data** ("Dono, 05/10 15h42: ..."). Até 300. Obrigatório |
| `tipo` | `conteudo`, `desenvolvimento`, `projeto` ou `outro` (padrão) |
| `prazo` | dia em que a tarefa precisa estar pronta, `AAAA-MM-DD`, ou `null` (21/10/2026). O dono vê "até sex, 24/10" e "atrasada" no Board |
| `estado` | `fazendo` (padrão), `travada`, `esperando_dono`, `concluida` ou `cancelada`. `esperando_danilo` é aceito como sinônimo de `esperando_dono` |
| `motivo` | obrigatório em `travada` e `esperando_dono`: o que travou, ou o que o dono precisa decidir. Até 300. Some sozinho quando a tarefa sai desses estados |
| `progresso` | 0 a 100, ou `null`. Opcional |
| `passos` | opcional, até 30: `[{"texto": "...", "feito": false}]`. Texto solto também vale e entra como não feito. Cada texto até 120 |
| `nota` | o que está fazendo agora, em uma linha (até 200). Serve de sinal de vida |
| `link` | opcional: onde ver o trabalho (`http://`, `https://` ou caminho do próprio Web começando com `/`) |
| `anexos` | opcional, até 20 links: `[{"rotulo": "...", "url": "https://..."}]`. Rótulo até 120 |

Campos que o servidor calcula na leitura (nunca gravados a partir do pedido):

- `progresso`: concluída é 100; o informado vence; sem informado e com `passos`, sai da conta
  (feitos ÷ total, arredondado). Sem nada disso é `null` (não medido), **nunca 0**.
  `progresso_origem` diz de onde veio: `informado`, `passos`, `concluida` ou `null`.
- `parada`: `true` quando está em `fazendo` e a última atualização passou de 45 minutos.
  Qualquer `PATCH`, mesmo `{}`, zera o relógio.
- `aberta`: `fazendo`, `travada` ou `esperando_dono`.
- `atualizada_ha_min`: minutos inteiros desde a última atualização.
- `versao`: muda a cada gravação da tarefa. Serve para o `If-Match`.

Toda criação e toda mudança ficam registradas (quem fez, quando, o antes e o depois de cada
campo) e voltam em `eventos` no `GET /api/v1/tarefas/<id>` (os 50 mais recentes).

## Quem pode o quê

| Quem chama | Ler | Criar | Alterar e cancelar |
| --- | --- | --- | --- |
| o dono (sessão do navegador) | tudo | para qualquer agente (`agente` obrigatório) | qualquer tarefa |
| um agente (pela caixa, `dgclaw-api` ou `dgclaw-mesa`) | a mesa inteira | só para si (o `agente` do corpo é ignorado se for o dele, e dá `403` se for outro) | só as próprias (`403` nas dos outros) |

`criada_por` e o `por` de cada evento dizem `dono (<usuario>)` ou `agente <slug>`.

**Quando o dono mexe numa tarefa de um agente**, o agente fica sabendo: o Web manda à sessão
dele, quando ela estiver livre, um recado curto começando com `[Mesa]` (por exemplo
`[Mesa] O dono respondeu na tarefa #12 "Roteiro...": nota "pode usar o gancho B"`). Para
mexer sem avisar, mande `"avisar_agente": false` no corpo. Mudança feita pelo próprio agente
não gera recado.

## Rotas

Todas exigem login (navegador) ou chegam pela caixa do agente. Erros sempre
`{"ok": false, "erro": "motivo em português"}`.

| Rota | O que faz |
| --- | --- |
| `GET /api/v1/tarefas` | a mesa. Padrão: todas as abertas + as concluídas e canceladas de hoje, de todos os agentes |
| `POST /api/v1/tarefas` | cria. `201` com `{ok, tarefa}` |
| `GET /api/v1/tarefas/<id>` | uma tarefa, com `eventos` |
| `PATCH /api/v1/tarefas/<id>` | muda só o que veio. `{}` é sinal de vida. Responde `{ok, tarefa, acao}`, com `acao` = `atualizou`, `concluiu`, `cancelou`, `reabriu` ou `sinal de vida` |
| `DELETE /api/v1/tarefas/<id>` | **cancela** (não apaga). Corpo opcional `{"motivo": "..."}`. Repetir devolve `ja_estava: true` |
| `GET /api/v1/tarefas/docs.md` | este documento |

Filtros do `GET /api/v1/tarefas`:

- `agente=luna` ou `agente=luna,marina`: só desses agentes. Slug que não existe dá `400`
  com a lista dos que existem;
- `estado=fazendo,travada`: só esses estados;
- `dia=hoje` (padrão), `dia=2026-10-04` ou `dia=todos`: o dia em que a tarefa fechada foi
  concluída ou cancelada. As abertas aparecem sempre.

A resposta traz `tarefas` (na ordem da mesa: esperando o dono, travada, parada?, fazendo,
concluída, cancelada; dentro de cada grupo, a atualizada mais recente primeiro), `agora`,
`parada_min` (45), `filtro` e `contagem` (`abertas`, `esperando_dono`, `travadas`, `paradas`).

**Cache:** a resposta traz `ETag`. Mandando `If-None-Match` com ele, o Web responde `304` sem
corpo quando nada mudou. O ETag inclui os filtros e o minuto atual, para o "parada?" e a
virada do dia aparecerem sem ninguém mexer.

**Conflito:** o `PATCH` e o `DELETE` aceitam `If-Match: "<versao>"`. Se a tarefa mudou desde
essa versão, a resposta é `412` com a `tarefa` atual, sem gravar. Quem não manda cabeçalho (o
agente, pela caixa) usa o campo `se_versao` no corpo, com o mesmo efeito.

Campos do `PATCH` além dos da tarefa:

| Campo | O que faz |
| --- | --- |
| `passo_feito` | número do passo (começa em 1) ou o texto exato: marca como feito |
| `passo_desfeito` | o mesmo, desmarcando |
| `anexos_add` | acrescenta links ao fim. URL repetida só troca o rótulo |
| `anexos_remover` | lista de URLs para tirar. URL que a tarefa não tem dá `400`, com as que existem |
| `se_versao` | o mesmo que `If-Match`, no corpo (para quem chama pela caixa) |
| `avisar_agente` | só para o dono: `false` não manda o recado `[Mesa]` ao agente |

`anexos` (lista inteira) não combina com `anexos_add` nem `anexos_remover` no mesmo pedido.
`titulo`, `origem` e `tipo` podem ser corrigidos; `agente` não.

**Erros:** `400` com `erros` campo a campo (ex.: `{"erros": {"motivo": "obrigatório quando o
estado é travada"}}`), `403` (agente mexendo em tarefa de outro), `404` (tarefa que não
existe), `412` (versão antiga), `413` (corpo maior que 64 KB), `503` (o arquivo da mesa não
abriu ou não gravou; o motivo vem no `erro`, e o arquivo nunca é trocado por uma mesa vazia).

## Pelo agente: o comando `dgclaw-mesa`

Roda dentro do container. Por baixo usa o `dgclaw-api` (a caixa do agente, veja
`docs/CAIXA-DO-AGENTE.md`). O agente não passa endereço nem chave.

```bash
dgclaw-mesa criar --titulo "Roteiro do reels" --origem "Dono, 05/10 15h42: faz o roteiro" \
  --tipo conteudo --passo pesquisa --passo roteiro --passo revisão
# imprime: tarefa #12 criada (fazendo) "Roteiro do reels"
dgclaw-mesa atualizar 12 --progresso 60 --nota "escrevendo o gancho"
dgclaw-mesa passo 12 1                      # marca o passo 1 como feito
dgclaw-mesa pedir 12 --motivo "gancho A ou B? mandei os dois na conversa"   # esperando_dono
dgclaw-mesa travar 12 --motivo "a API do Instagram caiu"
dgclaw-mesa retomar 12 --nota "dono escolheu o B"                          # volta a fazendo
dgclaw-mesa concluir 12 --link "https://..."
dgclaw-mesa cancelar 12 --motivo "o dono desistiu"
dgclaw-mesa vivo 12                         # sinal de vida (PATCH {})
dgclaw-mesa ver 12                          # a tarefa com os eventos
dgclaw-mesa listar                          # as minhas abertas e as de hoje
dgclaw-mesa listar --todos                  # a mesa inteira
```

Toda subcomando aceita `--json` para imprimir a resposta crua da API.

| Código de saída | Quer dizer |
| --- | --- |
| 0 | ok |
| 1 | erro de uso (faltou argumento, id que não é número) |
| 2 | o Web não respondeu (fora do ar ou reiniciando): tente de novo em instantes |
| 3 | a caixa do agente não está disponível: peça ao dono `sudo dgclaw agente reparar <slug>` |
| 4 | o Web recusou o pedido (4xx): a frase do `erro` sai no stderr |
| 5 | erro do lado do Web (5xx): a frase do `erro` sai no stderr |

Sem o Web, `dgclaw-mesa listar --retrato` lê a última cópia que o Web deixou em
`~/.dgclaw/retratos/mesa.json` (só as tarefas deste agente, abertas e de hoje).

## Na tela

`/mesa`, com o item **Mesa de tarefas** no menu da conversa. Um bloco por agente (foto, nome e
quantas abertas), com os cartões das tarefas. Esperando o dono e travada vêm primeiro, com o
motivo em destaque. Cada cartão mostra o estado, a barra de progresso (ou "sem medida" quando o
progresso é `null`), os passos, a nota, a origem, o link, os anexos e há quanto tempo foi
atualizado. Tocar no cartão abre os detalhes e o histórico.

Ações do dono no cartão: **Responder** (grava a resposta em `nota`, volta a `fazendo` e avisa
o agente), **Concluir**, **Cancelar**, **Reabrir** e **Editar**. No topo: **Nova tarefa**
(para um agente) e os filtros por agente e por dia. A tela se atualiza sozinha a cada 15 s
com `If-None-Match` e para de consultar enquanto a aba está escondida.

O botão **Tutorial** ao lado do título faz a visita guiada da página, e cada seção tem um `?`.

A página tem abas no topo. **Tarefas** é a mesa; outras frentes podem acrescentar abas pelo
registro `window.DGMesaAbas.registrar({ id, titulo, montar(elemento), bolinha })`.

## Estado e cópia de segurança

`<DGCLAW_WEB_DATA>/mesa/tarefas.json`, modo 0600, gravado por substituição atômica. Arquivo
inválido gera erro explícito (`503`) e nunca é substituído por uma mesa vazia. Fechadas há
mais de 90 dias saem do arquivo, que guarda no máximo 5.000 tarefas fechadas. Preserve a pasta
em backups e atualizações.
