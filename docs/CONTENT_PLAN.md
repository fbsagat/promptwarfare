# Plano: ciclo de conteúdo por prompts

> **Status:** Fases 0, 1, 2 e 3 implementadas (UX, prompt de texto livre, catálogo versionado, resolvedor determinístico, ledger, pipeline offline, telemetria de uso/qualidade, feedback, manifesto de assets e ligação inicial do cliente por ID). Fases de escala 1–6 implementadas: streaming de armas por referência, catálogo em índice + shards, resolvedor por índice invertido, assets sob demanda, contrato de diversão e observabilidade. Receitas visuais/sonoras por evento e armas modulares implementadas como primeira camada; eventos de cenário (`SCENERY_SPAWN`) adicionados ao catálogo com 6 estruturas que sobem do chão. Ainda faltam assets dedicados/gravados por evento e peças de modelo com arte autoral.
> **Próximos incrementos obrigatórios:** (1) substituir a receita procedural de evento por assets dedicados (textura/som/VFX por evento) mantendo o contrato `fun`; (2) evoluir as peças modulares para um catálogo de módulos autorais e variações de silhueta por arquétipo.
> **Última revisão:** 16/11/2026.
> **Fase 0 entregue:** contadores globais/individuais, `PromptBar` mínima, `prompt:open`/`prompt:cancel`, deadlines e timeout no servidor, freeze de movimento/ação durante a escrita, remoção de `allocation` da UI/protocolo/blueprint e testes de fluxo em `server/promptFlow.test.ts`.
> **Fase 1 entregue:** `content/catalog/catalog.json` versionado, `server/catalog.ts` com resolução por aliases/tags, `catalogVersion` no tick, remoção da IA do runtime (ferramenta movida para `tools/`), `/api/catalog` e `/api/ai/preview-weapon` servindo o catálogo, e testes em `server/catalog.test.ts`.
> **Fase 2 entregue:** `server/ledger.ts` append-only com escrita em lote, relatório de demanda/lacunas (`tools/ledger-report.ts`), geração offline de candidatos (`tools/catalog-candidates.ts`), promoção validada com versão (`tools/promote-candidates.ts`) e testes de ledger, relatório e promoção.
> **Fase 3 entregue:** `content_usage` com `equip`/`kill`/`damage`/`survival`/`event`/`feedback`, relatório de uso/qualidade (`tools/usage-report.ts`), feedback 👍/👎 no HUD, manifesto versionado `content/assets/manifest.json`, `assetVersion` no protocolo, `/api/assets`, carregamento do manifesto no cliente (som por elemento e waypoint de evento), validação de referências de assets e retenção via `tools/ledger-prune.ts`.
> **Endurecimento P0:** `schemaVersion` versionado com `status`/`provenance` por item, `catalog:build` preservando itens promovidos, resolvedor com `partial` para cobertura duvidosa, relatórios por janela recente (`--days`), validação/rate limit de feedback, rate limit de `prompt:open` e nome do catálogo no lugar do prompt cru em eventos.
> **Fechamento P1:** feedback de eventos no HUD, relatório `loop:report` cruzando demanda × uso × versão, detecção de lacunas fechadas/persistentes/regredidas, expansão de aliases nos candidatos, mesclagem de aliases em itens existentes na promoção e composição conservadora de capacidades no resolvedor.
> **Operação P2:** hot reload atômico do catálogo (`CATALOG_WATCH`/`SIGHUP`), `/api/metrics` com agregados e token opcional, health check ampliado e agendamento documentado de `loop:report`/`ledger:prune`.
> **Pool P2:** arsenal determinístico por sala (`server/contentPool.ts`) com núcleo obrigatório, peso inverso ao uso humano, quota de novidade (`introducedIn`/provenance), `pool_hash`/`pool_miss` no ledger e separação entre “fora do pool” e lacuna de catálogo nos relatórios.
> **Observabilidade P2:** `introducedIn` no schema 3 do catálogo, alertas agregados em `/api/metrics` (baixa cobertura, pool miss alto, lacunas regredidas, cobertura duvidosa e ausência de uso).
> **Dedup P2:** embeddings lexicais determinísticos (`server/semantic.ts`), quase-duplicatas (`server/semanticDuplicates.ts`), `catalog:dedupe` e merge semântico na promoção com tag/arquétipo compartilhados.
> **Composição de eventos:** `MapEventState.components` combina categorias, escala o componente secundário para o orçamento total de 100 e aplica todos os efeitos no tick.
> **Assets P2:** manifesto com `url`/`mimeType`/`hash`, `ASSET_BASE_URL`, resolução relativa no cliente, textura de arma e sample de som reais com fallback procedural, e `assets:check` para validar CDN.
> **Biblioteca inicial ampliada:** catálogo com 90 armas (15 arquétipos × 6 elementos) e 30 eventos (9 de clima, 8 de terreno, 8 de entidades e 5 de suprimentos), todos aprovados sem clamp, com novos `weatherKind`/`mutationKind` aplicados no tick autoritativo e `catalog:dedupe` sem pares acima do threshold padrão.
> **Documentos relacionados:** [ARQUITETURA](ARCHITECTURE.md), [PROTOCOLO](PROTOCOL.md), [DEPLOY](DEPLOY.md).

## 1. Objetivo

Transformar os prompts dos jogadores em um ciclo de conteúdo sustentável:

1. **Capturar** o que os jogadores pedem, com contexto e resultado, em um ledger append-only.
2. **Servir** o pedido usando o catálogo que o jogo já possui, de forma determinística e imediata.
3. **Agregar** a demanda e as lacunas para o desenvolvedor produzir novos conteúdos e assets **offline**.
4. **Publicar** esses conteúdos em uma nova versão do catálogo, com curadoria humana.
5. **Medir** uso, qualidade e cobertura para priorizar o próximo ciclo.

A IA é usada **apenas no pipeline offline de produção do catálogo**. O servidor do jogo não chama IA, não depende de rede externa e não gera conteúdo em tempo real.

## 2. Decisões e premissas

`Confirmado` = fechado nesta conversa. `Assumido` = recomendação aceita por omissão, sujeita a confirmação. `Proposta` = desenho deste plano, ainda não validado.

| Tema | Decisão | Status |
| --- | --- | --- |
| IA no runtime | Removida. Nenhuma chamada a Gemini durante a partida. | Confirmado |
| IA no projeto | Apenas ferramenta offline do dev para gerar candidatos ao catálogo. | Confirmado |
| Contadores | Dois: evento global (sala) e forja individual (jogador). | Confirmado |
| Evento global | 10s para reivindicar + 20s de escrita; se não reivindicar, pula e reinicia. | Confirmado |
| Tecla | `Enter` como toggle (abre e executa); `T`/`Y` como atalhos de abertura. | Confirmado |
| Input | Texto livre, até 90 caracteres, sem tags, chips, sliders ou botões. | Confirmado |
| Orçamento | 100 pontos é trava interna de balanceamento, não escolha do jogador. | Confirmado |
| Alocação | Removida da UI, do protocolo e do blueprint. | Confirmado |
| Autoridade | Servidor dono dos prazos, do freeze e do timeout. | Proposta |
| Forja pronta | Permanece pronta até o jogador usar. | Assumido |
| Publicação | Humana. Nada gerado por IA entra no catálogo sem revisão. | Proposta |
| Catálogo | Artefato versionado; o runtime só lê. | Proposta |
| Ledger | Append-only; pedidos e eventos de uso separados do catálogo. | Proposta |
| Resolvedor | Determinístico, local, sem rede. | Proposta |
| Prompts simultâneos | Um por jogador; o evento global tem prioridade. | Proposta |
| Demanda | Bots, dev tools e preview não contam como demanda humana. | Proposta |

## 3. Fora de escopo

- IA conectada ao servidor, geração sob demanda ou fallback por LLM em partida.
- Promoção automática de conteúdo gerado por IA.
- Treino online, bandit ou ajuste automático de balanceamento em produção.
- Contas persistentes de jogador (o plano funciona com identidade efêmera).
- Múltiplas instâncias do servidor (o desenho prepara o caminho, mas não exige agora).
- Geração de texturas, sons ou modelos em tempo real.

## 4. Visão geral do ciclo

```text
PARTIDA
  │  prompt + contexto
  ▼
LEDGER (append-only) ──────────────────────────────┐
  │                                                │
  │ agregação offline                              │ telemetria de uso
  ▼                                                ▼
CLUSTERS / LACUNAS ──► BRIEF ──► IA OFFLINE ──► CANDIDATOS
                                                │
                                                ▼
                                      VALIDAÇÃO + CURADORIA
                                                │
                                                ▼
                                      CATÁLOGO VERSIONADO
                                                │
                                                ▼
PARTIDA ◄──────────── RESOLVEDOR DETERMINÍSTICO ◄┘
```

O ciclo é **de release**, não de tempo real. O jogo coleta e serve; o dev produz e publica.

## 5. UX e fluxo de input

### 5.1 Os dois contadores

- **Global (topo central):** ciclo do evento global, visível para todos. Mostra o tempo até o sorteio e, depois, o nome do sorteado e a janela em andamento.
- **Individual (rodapé central):** recarga da forja do jogador local. Mostra o tempo até ficar pronta e, depois, o estado “pronta”.

Os contadores são a interface principal. Não há modal, botão grande ou pop-up cobrindo a tela.

### 5.2 Evento global

| Fase | Contador | Quem vê | Transição |
| --- | --- | --- | --- |
| `cooldown` | “Evento global em 24s” | todos | zero → sorteio |
| `raffle` | “Sorteado: Ana · 10s” | todos; Ana em destaque | Ana abre → escrita; 0s → pula e reinicia; morte/saída → re-sorteia |
| `writing` | “Evento em preparação · 20s” | todos; Ana vê só o input | envia → evento + reinicia; cancela/expira → pula e reinicia; morte → cancela e reinicia |
| `bot` | “Sorteado: Bot · 3s” | todos | bot autoenvia e reinicia |

Regras:

- O sorteio considera apenas jogadores **vivos e disponíveis** (sem prompt aberto).
- Humanos têm prioridade; bots são fallback quando não há humano disponível.
- O nome do sorteado aparece para todos.
- Se o sorteado não reivindicar em 10s, o evento é pulado e o ciclo reinicia.
- Se o sorteado morrer ou desconectar durante o sorteio ou a escrita, o evento é cancelado e um novo sorteio acontece entre os vivos disponíveis; se não houver ninguém, o ciclo reinicia.
- O jogador sorteado não pode abrir a forja enquanto o evento estiver ativo.

### 5.3 Forja individual

| Fase | Contador | Transição |
| --- | --- | --- |
| `cooling` | “Forja em 18s” | zero → pronta |
| `ready` | “Forja pronta — Enter” | abre → escrita; permanece pronta até usar |
| `writing` | barra de input | envia → equipa + 30s; cancela → volta a pronta; expira → 8s de recarga |
| `dead` | oculto | respawn reinicia |

Regras:

- A forja pronta não expira.
- O jogador pode abrir a forja quando quiser, desde que não tenha outro prompt aberto.
- Se o evento global estiver ativo para ele, o evento tem prioridade.
- Cancelar não consome a forja; apenas fecha o input.
- Expirar aplica a recarga curta atual (8s) para desencorajar inatividade.

### 5.4 Barra de input

Quando o jogador aperta a tecla, aparece **apenas**:

- uma barra de texto de uma linha, no rodapé central;
- limite de 90 caracteres;
- progresso do tempo embutido na própria barra (linha que encolhe);
- dica discreta de `Enter` para executar e `Esc` para cancelar;
- nenhum título, slider, chip, botão ou fundo escuro.

O mundo continua visível; a HUD é apagada ou reduzida ao mínimo. O pointer lock é liberado, o movimento para e o personagem fica vulnerável. O servidor bloqueia movimento e ação nesse estado.

Ao enviar, cancelar ou expirar, a barra fecha, o pointer lock volta e a HUD retorna.

### 5.5 Teclas

`Enter` é o toggle único:

- aviso: “Enter para escrever”;
- primeira pressão: abre o input;
- segunda pressão: executa o texto.

`T` e `Y` continuam como atalhos opcionais de abertura. Letras precisam continuar digitáveis dentro do input; por isso `T`/`Y` não podem ser a tecla de executar.

Quando evento e forja estão disponíveis ao mesmo tempo, o evento tem prioridade no `Enter`; a forja continua pronta e pode ser aberta com `T`.

### 5.6 Orçamento de 100 pontos

O orçamento é uma **trava de design**, não uma escolha do jogador:

- `validateAndClampWeapon` e `validateAndClampEventParams` continuam limitando dano, rajada, leque, cratera, letalidade e quantidade.
- Nenhuma arma elimina em um tiro.
- Não há sliders no prompt, no lobby ou em qualquer tela.
- O campo `allocation` sai do protocolo, do `WeaponBlueprint` e da chave do catálogo.
- A distribuição interna pode continuar existindo no gerador/validador, mas nunca como entrada do jogador.
- Bots podem usar tags/arquétipos internos (`explosivo`, `preciso`, `pesado`) em vez de pontos.
- O killfeed pode continuar exibindo `x/100` como leitura de poder; é informação, não controle.

### 5.7 Casos de borda

| Caso | Comportamento |
| --- | --- |
| Morte durante a escrita | Fecha o input; cancela a ação; respawn reinicia a forja. |
| Desconexão | Limpa o prompt; se era o sorteado do evento, re-sorteia. |
| Timeout do evento | Pula o evento e reinicia o ciclo global. |
| Timeout da forja | Cancela e aplica 8s de recarga. |
| Cancelamento explícito | Evento é consumido; forja volta a pronta. |
| Enter com texto vazio | Não envia; a barra continua aberta. |
| Duplo envio | O servidor ignora o segundo; o cliente desabilita após o primeiro. |
| Todos os vivos estão escrevendo | O sorteio é pulado e o ciclo reinicia. |
| Jogador morto | Não entra no sorteio e não vê a forja. |
| Aba em segundo plano | O servidor continua contando; o cliente sincroniza ao voltar. |
| Pausa local | O jogo não pausa no servidor; o menu de pausa não abre durante a escrita. |

## 6. Autoridade do servidor

### 6.1 Estado da sala

- `eventPhase`: `cooldown` | `raffle` | `writing` (ou `bot`).
- `eventCooldownEndsAt`: deadline do próximo sorteio.
- `rafflePlayerId`, `rafflePlayerName`, `raffleEndsAt`.
- `eventWritingEndsAt` enquanto o sorteado escreve.

### 6.2 Estado do jogador

- `forgePhase`: `cooling` | `ready` | `writing` | `dead`.
- `forgeCooldownEndsAt` / `forgeWritingEndsAt`.
- `promptKind`: `weapon` | `event` | `null`.
- `promptEndsAt`.

`isTypingPrompt` pode continuar existindo como campo derivado para compatibilidade, mas a autoridade é `promptKind`.

### 6.3 Regras de transição

- `prompt:open` só é aceito se o jogador está vivo, é o sorteado (evento) ou está com a forja pronta (arma), e não tem outro prompt aberto.
- `prompt:open` inicia o deadline de escrita no servidor.
- `prompt:cancel` limpa o estado e aplica as regras de cancelamento.
- O timeout é do servidor; o cliente não envia mais `ai:weapon_prompt_timeout`.
- Movimento e `player:action` são rejeitados enquanto `promptKind !== null`.
- O sorteio exclui jogadores com `promptKind !== null`.
- O evento é re-sorteado se o sorteado morrer ou desconectar.
- Bots usam a mesma máquina de estados no servidor, com autoabertura e autoenvio; não geram eventos de ledger humano.

### 6.4 Deadlines e contadores suaves

O tick envia deadlines absolutos e `serverNow`. O cliente interpola o tempo restante para o contador não “pular” a cada segundo. Os campos antigos em segundos podem permanecer durante a migração, mas os novos são a fonte de verdade.

### 6.5 Escritas do ledger

O ledger é escrito fora do caminho crítico do tick, em fila/lote. O catálogo é somente leitura em runtime. Nenhuma gravação síncrona deve bloquear o loop de 20 Hz.

## 7. Protocolo

### 7.1 Cliente → servidor

| Tipo | Payload | Efeito |
| --- | --- | --- |
| `prompt:open` | `{ kind: 'weapon' \| 'event' }` | Valida e inicia a janela de escrita. |
| `prompt:cancel` | `{ kind }` | Cancela o input e aplica a regra do estado. |
| `ai:forge_weapon` | `{ prompt }` | Submete o texto da forja. Sem `allocation`. |
| `ai:trigger_event` | `{ prompt }` | Submete o texto do evento global. |
| `player:input` | movimento/olhar/slot | Sem autoridade sobre o estado do prompt. |
| `player:action` | `{ origin, dir }` | Rejeitado enquanto o jogador está escrevendo. |

Removidos:

- `ai:weapon_prompt_timeout` (o servidor expira sozinho).
- `allocation` de `ai:forge_weapon`.
- `isTypingPrompt` como sinal autoritativo no `player:input`.

### 7.2 Servidor → cliente

| Tipo | Conteúdo |
| --- | --- |
| `room:tick` | Inclui `serverNow`, `event: { phase, endsAt, rafflePlayerId, rafflePlayerName }`, `forge: { phase, endsAt }` e `prompt: { kind, endsAt } \| null`. |
| `room:init` | Inclui `catalogVersion` e o estado inicial dos contadores. |
| `ai:weapon_ready` | Cue de arma equipada. |
| `ai:event_raffle_won` | Cue de sorteio; o tick continua sendo a verdade. |
| `ai:error` | Mensagem em português para estado inválido, prompt vazio ou duplo envio. |

`docs/PROTOCOL.md` deve ser atualizado quando a implementação começar.

## 8. Catálogo de conteúdo

### 8.1 Fonte de verdade e versão

- Fonte de verdade em arquivos revisáveis no repositório (proposta: `content/catalog/*.json`), validados por testes.
- O runtime carrega um índice compilado (SQLite ou JSON) **somente leitura**.
- Cada release tem um `catalogVersion`; partidas e ledger registram essa versão.
- Rollback = deploy da versão anterior.
- Mudanças de balanceamento **não apagam** itens; marcam como `deprecated`.

### 8.2 Tipos de conteúdo

- `weapon`
- `event`
- `entity`
- `objective` (missões/waypoints, se entrarem no escopo)
- `asset` (apresentação: textura, som, efeito, waypoint, malha)

#### Eventos de cenário (`SCENERY_SPAWN`)

Além de clima, terreno, criaturas e suprimentos, o catálogo tem eventos que **constroem cenário** a partir do chão:

| Evento | `sceneryKind` | Exemplos de prompt |
| --- | --- | --- |
| Árvore emergente | `tree` | “árvore”, “surja uma árvore” |
| Bosque repentino | `grove` | “bosque”, “floresta” |
| Casa do chão | `house` | “casa”, “cabana”, “chalé” |
| Torre emergente | `tower` | “torre”, “prédio”, “edifício” |
| Arranha-céu do chão | `skyscraper` | “arranha-céu”, “edifício gigante” |
| Ruínas emergentes | `ruins` | “ruínas”, “templo antigo” |

Regras de design:

- a estrutura é gerada em voxels determinísticos (`src/shared/scenery.ts`), não é um asset binário;
- o servidor reserva uma área livre de jogadores, apoia no `groundY` e aplica **uma camada por tick**, então o objeto sobe do chão;
- a estrutura **permanece no mapa** depois do evento e vira cobertura/verticalidade/rota;
- escadas internas (`MAT.LADDER`) em torres e arranha-céus tornam a subida parte da contra-jogada;
- `quantity` limita quantas estruturas nascem e entra no orçamento de 100 pontos;
- o evento usa o contrato de diversão `SCENERY_SPAWN` (`climb`, `high_ground`, `shelter`) e a receita visual/sonora de `eventPresentation.ts`;
- o catálogo usa a tag `terrain` para o pool, mas o arquétipo é separado para a geração e para o HUD.

### 8.3 Formato conceitual de um item

```json
{
  "id": "wpn_ice_pistol",
  "kind": "weapon",
  "status": "approved",
  "provenance": "ai_assisted",
  "version": 3,
  "tags": ["weapon", "pistol", "ice", "freeze"],
  "aliases": ["pistola de gelo", "arma congelante", "criogun"],
  "capabilities": ["status:freeze", "palette:ice", "sfx:ice"],
  "payload": { "WeaponBlueprint": "validado" },
  "budgetUsed": 72,
  "wasClamped": false,
  "createdAt": 0,
  "approvedAt": 0
}
```

Campos de controle:

- `status`: `candidate` | `approved` | `deprecated`.
- `provenance`: `authored` | `ai_assisted` | `template` | `seed`.
- `aliases`: formas normalizadas que o resolvedor reconhece.
- `capabilities`: IDs de comportamento/efeito que o servidor e o cliente conhecem.
- `budgetUsed` / `wasClamped`: auditoria do orçamento de 100 pontos.

### 8.4 Assets

- O servidor referencia **IDs**; o cliente resolve a apresentação.
- O manifesto informa tipo, hash, URL, parâmetros e status.
- Waypoints e posicionamento são validados pelo servidor (mapa, distância, fairness); o prompt nunca escolhe coordenadas.
- Texturas, sons e efeitos entram por release, não por partida.

### 8.5 Aliases e tags

- Gerados offline (manuais ou assistidos por IA) a partir da demanda agregada.
- O runtime faz correspondência determinística por prompt normalizado, aliases e tags.
- Não há embedding de prompt em tempo real; se embeddings forem usados, são pré-computados no catálogo.

### 8.6 Pool por partida

O servidor monta um pool de conteúdo aprovado por partida, considerando:

- tamanho da sala e duração esperada;
- tema/season;
- diversidade e novidade;
- itens recém-publicados (quota de exploração);
- fairness e orçamento.

O prompt do jogador resolve **contra esse pool**, não contra o catálogo inteiro. A exceção é o pedido explícito: nome/alias exato ou chave canônica de um item aprovado é honrado mesmo fora do pool (registrado como `pool_miss`); prompts vagos continuam limitados ao arsenal da sala.

## 9. Resolvedor determinístico

| Degrau | Quando | Custo |
| --- | --- | --- |
| Alias exato | prompt normalizado bate em um alias | ~0 |
| Tag/canonical | tags ou chave canônica batem | baixo |
| Composição | capacidades existentes cobrem o pedido | baixo |
| Família/template | cai numa família segura | baixo |
| Default | nada cobriu | ~0 |

Regras:

- Sem rede, sem LLM, sem geração em tempo real.
- A resposta é imediata; a arma é equipada ou o evento enfileirado no mesmo tick.
- Se não houver cobertura: adapta o item mais próximo, marca `fromCatalog` e registra a lacuna no ledger. Proposta: nunca bloquear o jogador.
- A UI mostra “catálogo”/“adaptado”, não “banco”.
- Testes golden cobrem cada degrau e o comportamento sem cobertura.

## 10. Ledger e telemetria

### 10.1 Tabelas conceituais

| Tabela | Grão | Papel |
| --- | --- | --- |
| `prompt_submissions` | uma linha por abertura/envio | pedido imutável com contexto e resultado |
| `content_items` | um item de catálogo | oferta versionada e status |
| `content_usage` | uso por partida/item/jogador | qualidade e impacto |
| `content_feedback` | feedback explícito | sinal de qualidade |
| `demand_clusters` | cluster de intenção | agregação para o dev |
| `asset_registry` | asset de apresentação | IDs e metadados |

### 10.2 Campos de `prompt_submissions`

- `id`, `created_at`;
- `actor_type` (`human` | `bot` | `dev` | `preview`);
- `actor_ref` pseudônimo, `room_id`, `match_id`;
- `kind` (`weapon` | `event`);
- `raw_prompt`, `normalized_prompt`, `canonical_key`;
- `resolution_strategy`, `content_id`, `catalog_version`, `balance_version`;
- `budget_used`, `was_clamped`;
- `opened_at`, `submitted_at`, `cancelled_at`, `timed_out_at`;
- `claim_latency_ms`, `write_duration_ms`;
- `killed_while_typing`;
- `status`.

### 10.3 Eventos registrados

- prompt aberto, enviado, cancelado, expirado;
- latência entre o contador e a abertura;
- tempo de escrita;
- morte durante a escrita;
- estratégia de resolução e item servido;
- uso posterior: equipou, causou dano, abateu, sobreviveu, foi trocado logo depois;
- evento: impacto, jogadores afetados, duração;
- feedback explícito.

Texto de rascunho cancelado não é enviado por padrão; cancelamento/timeout registram apenas metadados. Prompts enviados são armazenados. Uma política de retenção e limpeza de PII deve acompanhar o ledger.

### 10.4 Métricas

- **Cobertura:** % de prompts resolvidos por item aprovado.
- **Reuso:** % servido pelo catálogo vs. adaptação/default.
- **Lacunas:** prompts sem cobertura, agrupados.
- **Qualidade:** dano/abate/sobrevivência por item, troca imediata, feedback.
- **UX:** taxa de abertura, cancelamento, timeout, tempo de escrita.
- **Custo:** geração offline por release, não por partida.

### 10.5 Exclusões

Bots, dev tools e `/api/ai/preview-weapon` não entram na demanda humana. Eles podem ser usados como sementes de oferta, mas com `actor_type` explícito.

## 11. Pipeline offline do dev

1. **Exportar** clusters, lacunas e métricas do ledger.
2. **Priorizar** por frequência × qualidade × recência × esforço.
3. **Escrever o brief:** intenção, prompts representativos, volume, lacuna, capacidades sugeridas, critérios de aceite.
4. **Gerar candidatos com IA offline:** blueprints, paletas, malhas, texturas, sons, efeitos, waypoints.
5. **Validar automaticamente:** schema, orçamento de 100, nenhuma arma one-shot, malha sã (sólidos, bounding box, grip/muzzle), performance, contraste de paleta, duração/volume de áudio, tamanho de textura, duplicatas, moderação.
6. **Curadoria humana:** aprovar, rejeitar ou ajustar.
7. **Publicar:** bump de `catalogVersion`, PR/revisão, deploy.
8. **Medir:** a próxima partida já usa o item e gera telemetria.

Sem auto-merge. A IA acelera a produção; a decisão continua humana. A chave do Gemini fica apenas no ambiente da ferramenta offline, nunca no servidor do jogo.

## 12. Invariantes e guardrails

- O orçamento de 100 pontos é interno e obrigatório.
- Nenhuma arma elimina em um tiro.
- O servidor é autoritativo para prazos, freeze, dano, voxels, posicionamento e sorteio.
- Nenhuma IA no processo do servidor; o jogo sobe sem `GEMINI_API_KEY`.
- O cliente nunca escolhe coordenadas, estatísticas ou itens fora do catálogo aprovado.
- Um prompt por jogador; evento tem prioridade.
- Nenhuma ação/movimento enquanto o jogador está escrevendo.
- Bots/dev/preview não contaminam a demanda.
- Ledger append-only; catálogo versionado e read-only.
- Escritas do ledger fora do tick.
- Testes offline; validadores e resolvedor testáveis sem rede.
- Strings de jogador em pt-BR.
- Nenhum segredo em variáveis `VITE_*`.

## 13. Impacto no código atual

| Arquivo | Mudança |
| --- | --- |
| `src/components/PromptOverlay.tsx` | Vira `PromptBar` mínima: input, progresso e dica; sem sliders, título ou botão. |
| `src/components/GameHud.tsx` | Troca botões de evento/forja por dois contadores persistentes; adiciona foco de escrita. |
| `src/App.tsx` | Estado do prompt vem do tick; remove timeout local e alocação no submit; ajusta teclas. |
| `src/engine/babylonArena.ts` | Mantém `setPromptOpen`; abre só quando o estado permite; libera pointer lock e congela movimento/tiro. |
| `src/shared/types.ts` | Remove `WeaponAllocation` e `allocation`; adiciona estados de evento/forja/prompt, `serverNow` e `fromCatalog`. |
| `src/shared/budget.ts` | Mantém validadores e orçamento; remove defaults/alocação do jogador; adiciona constantes de janela. |
| `src/shared/botBrain.ts` | Substitui `weaponAllocation` por tags/arquétipos internos ou pesos do gerador. |
| `server/roomManager.ts` | Máquina de estados, deadlines, freeze, sorteio com disponibilidade, re-sorteio, bots e ledger. |
| `tools/aiGenerator.ts` | Ferramenta offline; não é importada pelo runtime. |
| `tools/blueprintDb.ts` | Cache SQLite apenas da ferramenta offline. |
| `server/catalog.ts` | Carrega o catálogo versionado e resolve prompts localmente. |
| `content/catalog/catalog.json` | Fonte de verdade do conteúdo aprovado. |
| `server.ts` | Remove geração em `/api/ai/preview-weapon`; vira resolução de catálogo ou sai. |
| `docs/PROTOCOL.md` | Novas mensagens/estados e remoções. |
| `docs/ARCHITECTURE.md` | Novo fluxo de prompt, catálogo e ledger. |
| `docs/DEPLOY.md` | `GEMINI_API_KEY` sai do servidor; ferramenta offline separada. |
| `README.md` | Atualiza destaques, controles e loop quando implementado. |
| Testes | Máquina de estados, timeout, morte, prioridade, freeze, ledger, catálogo, resolvedor, orçamento e exclusões. |

## 14. Fases

### Fase 0 — UX e fundação de dados

Entregas:

- dois contadores;
- barra de input mínima;
- `Enter` toggle e atalhos;
- máquina de estados server-authoritative;
- freeze e timeout no servidor;
- remoção da alocação da UI/protocolo;
- ledger de abertura/envio/cancelamento/timeout;
- testes de estado e casos de borda.

Pode manter o gerador atual temporariamente atrás da nova UI. A UI e a máquina de estados não dependem do catálogo.

### Fase 1 — Catálogo e resolvedor

Entregas:

- catálogo versionado e read-only;
- aliases/tags;
- resolvedor determinístico em degraus;
- resposta imediata e `fromCatalog`;
- cobertura/lacunas no ledger;
- remoção da IA do runtime;
- servidor sobe sem chave do Gemini;
- `/api/ai/preview-weapon` deixa de gerar.

### Fase 2 — Pipeline do dev

Entregas:

- exportação de clusters e lacunas;
- briefs;
- geração offline assistida por IA;
- validadores automáticos;
- fluxo de aprovação e publicação;
- proveniência e `catalogVersion` por release.

### Fase 3 — Assets

Entregas:

- manifesto de texturas, sons, efeitos e waypoints;
- carregamento por ID no cliente;
- validação de posicionamento no servidor;
- packs reutilizáveis (ex.: “gelo” cobre material, som, partícula e variações de malha).

### Fase 4 — Escala

Entregas (quando necessário):

- Postgres/fila para o ledger se houver múltiplas instâncias;
- CDN para assets;
- observabilidade e dashboards;
- embeddings pré-computados, se o matching lexical não bastar.

## 15. Critérios de aceite

### UX

- [ ] Dois contadores sempre visíveis durante a partida, com contagem suave.
- [ ] Evento só sorteia jogador vivo e disponível; nome visível para todos.
- [ ] Input só aparece após a tecla; contém apenas texto e progresso.
- [ ] `Enter` abre e executa; `T`/`Y` abrem; letras continuam digitáveis.
- [ ] HUD apagada durante a escrita; mundo visível; personagem vulnerável.
- [ ] Morte, desconexão, cancelamento e timeout limpam o estado sem travar a UI.

### Servidor

- [ ] Prazos e timeout são do servidor; não há prompt preso se o cliente travar.
- [ ] Movimento e ação são rejeitados durante a escrita.
- [ ] Um prompt por jogador; evento tem prioridade.
- [ ] Evento é re-sorteado em morte/desconexão do sorteado.
- [ ] Contadores usam deadlines absolutos e `serverNow`.
- [ ] Escritas do ledger não bloqueiam o tick.

### Conteúdo

- [ ] Orçamento de 100 é validado internamente; nenhuma arma one-shot.
- [ ] `allocation` não existe na UI, no protocolo nem no blueprint.
- [ ] Catálogo é versionado, read-only no runtime e reversível por deploy.
- [ ] Resolvedor é determinístico, local e testado nos cinco degraus.
- [ ] Sem cobertura, o jogador recebe adaptação/default e a lacuna é registrada.
- [ ] Bots/dev/preview não entram na demanda humana.

### Pipeline

- [ ] IA só roda offline; servidor sobe sem `GEMINI_API_KEY`.
- [ ] Candidatos passam por validação automática e curadoria humana.
- [ ] Publicação gera nova `catalogVersion`.
- [ ] Proveniência e versão ficam registradas.

### Documentação

- [ ] `PROTOCOL.md`, `ARCHITECTURE.md`, `DEPLOY.md` e `README.md` atualizados.
- [ ] Strings de jogador em pt-BR.
- [ ] Testes continuam offline.

## 16. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Cauda longa de prompts sem cobertura | Aliases, composição, famílias, default adaptado e cadência de releases. |
| Catálogo pequeno e partidas repetitivas | Packs temáticos, variações de paleta/malha, quota de novidade. |
| Gargalo no dev | Priorizar clusters, não prompts; packs reutilizáveis. |
| Dados sem sinal de qualidade | Telemetria de uso, feedback e curadoria; frequência sozinha não basta. |
| Prompt abuse/PII | Moderação, pseudonimização, retenção e limpeza. |
| Ledger bloqueando o tick | Fila/lote fora do caminho crítico. |
| Cliente e servidor com versões diferentes | `catalogVersion` e manifesto de assets no handshake. |
| Falta de agência após remover alocação | Texto livre + variedade de catálogo + tags internas; medir satisfação. |
| Confusão com `Enter` | Aviso claro, som, tutorial de primeira partida e `T`/`Y` como alternativas. |
| Evento pulado por inatividade | Re-sorteio/skip transparente; avaliar fallback de catálogo se o ritmo cair. |

## 17. Pendências

Itens ainda não fechados, com recomendação:

1. **Forja pronta:** permanece pronta até usar (assumido/recomendado) ou expira em X segundos.
2. **Objetivos/waypoints:** entram como tipo de conteúdo desde a Fase 0 ou só na Fase 3.
3. **Contas persistentes:** identidade efêmera por sessão ou conta de jogador.
4. **Deployment/escala:** uma VPS com ledger SQLite (atual) ou múltiplas instâncias com banco compartilhado.
5. **Retenção/PII:** definir o prazo oficial e agendar `ledger:prune` (a ferramenta já existe).
6. **Tutorial:** como ensinar o `Enter` na primeira partida.
7. **Assets no cliente:** som por elemento e waypoint já usam o manifesto; ainda faltam texturas/efeitos completos no rendering.

Decididos durante a implementação: catálogo em JSON no repositório, sem cobertura → adaptação/default registrada, killfeed mantém `x/100` como leitura de poder e evento sem claim é pulado.

## 18. Referências

- `server/roomManager.ts` - timers, sorteio, forja, eventos e bots.
- `server/catalog.ts` - catálogo read-only e resolvedor determinístico.
- `server/ledger.ts` - ledger append-only de prompts.
- `server/ledgerReport.ts` - agregação de demanda/lacunas.
- `content/catalog/catalog.json` - fonte de verdade do conteúdo.
- `tools/build-catalog.ts` - gerador offline do catálogo procedural.
- `tools/ledger-report.ts` - gera relatórios de demanda.
- `tools/catalog-candidates.ts` - gera candidatos offline.
- `tools/promote-candidates.ts` - valida e publica candidatos.
- `tools/aiGenerator.ts` - ferramenta offline de IA.
- `src/components/PromptBar.tsx` - barra mínima de prompt.
- `src/components/GameHud.tsx` - contadores de evento/forja.
- `src/App.tsx` - controle do prompt e do WebSocket.
- `src/engine/babylonArena.ts` — pointer lock e freeze.
- `src/shared/types.ts` — protocolo e tipos.
- `src/shared/budget.ts` — orçamento de 100 pontos.
- `src/shared/botBrain.ts` — perfis de bots.
- `docs/PROTOCOL.md` — mensagens WebSocket.
