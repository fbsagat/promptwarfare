# Eventos catastróficos

> **Regra do projeto:** todo evento aprovado é uma catástrofe jogável. Não existe evento “decorativo” ou reskin. O evento precisa ser visto de longe, mudar a leitura do mapa, ter assinatura física própria, contra-jogada clara e recompensa no perigo.

## Pilares

1. **Escala épica** — clima e terreno podem ocupar a ilha inteira; entidades, suprimentos e cenário precisam de impacto regional ou estrutural.
2. **Assinatura única** — cada evento tem um `EventSignature` exclusivo e uma mecânica sistêmica que nenhum outro repete.
3. **Reação em cadeia** — o evento interage com materiais, água, estruturas, criaturas e outros eventos.
4. **Caos legível** — aviso de 5 a 10 s, sinais premonitórios, fases de impacto, sustentação, clímax e rescaldo.
5. **Contra-jogada obrigatória** — no mínimo duas respostas entre abrigo, escavação, altura, sprint, slide, mantle, grapple, zipline, item ou timing.
6. **Recompensa no perigo** — epicentro ou rescaldo entrega loot, núcleo ou relíquia.
7. **Zero dano inevitável** — `fairness.unavoidableDamage = false` e `maxLethality <= 45`.
8. **Cinema completo** — VFX, SFX, câmera, HUD, iluminação e áudio ambiente dedicados.
9. **Performance** — partículas são derivadas no cliente a partir de pulsos autoritativos; nada de partícula no protocolo.
10. **Teste offline** — orçamento, contrato `fun`/épico, assets, resposta de bot e ausência de one-shot.

## Arquitetura

| Camada | Arquivo | Papel |
| --- | --- | --- |
| Contrato | `src/shared/eventMechanics.ts` | Assinatura, fases, intensidade, escala épica, cadência e metadados de apresentação. |
| Fairness | `src/shared/eventFun.ts` | Contra-jogada, leitura, risco/recompensa e resposta de bot. |
| Simulação | `server/eventEngine.ts` | Forças, pulsos, crateras, bombas, núcleos e reações de mundo. |
| Protocolo | `src/shared/types.ts` | `EventPulse`, `EventPhase` e campos de estado do evento. |
| Cliente | `src/engine/babylonArena.ts` | Rigs visuais, pulsos, tremor de câmera e efeitos de impacto. |
| Áudio | `src/engine/soundSynth.ts` | Cues procedurais por assinatura (vórtice, erupção, sismo, onda). |

## Escala e orçamento

O orçamento continua sendo **100 pontos** e limita dano/quantidade, não espetáculo. A fórmula de evento usa retorno decrescente para o raio:

- raio: `sqrt(raio) * 4.6`;
- duração: `duração * 0.28`;
- letalidade: `letalidade * 1.15`;
- quantidade: `3.5` por unidade em entidades, suprimentos e cenário.

Assim, um evento de 70 m, 60 s e letalidade 22 cabe no orçamento sem virar one-shot. Os limites de catálogo são raio 6–130 m, duração 15–120 s e quantidade 1–20. Componentes compostos podem ser reduzidos abaixo disso para caber no total.

## Fases

| Fase | Progresso | Leitura |
| --- | --- | --- |
| `warning` | antes do impacto | Sirene, anel, sweep, HUD e sinais no céu. |
| `impact` | 0–14% | Primeiro golpe, cratera, onda de choque. |
| `sustain` | 14–62% | Pulsos regulares e caos contínuo. |
| `climax` | 62–86% | Evento muda de escala, spawna núcleo e libera o golpe assinatura. |
| `dissipate` | 86–100% | Rescaldo, fumaça, loot e terreno alterado. |

## Clima completo — 9 assinaturas

### Tornado F5 — `multi_vortex`

- O centro se desloca pelo mapa em figura-8; no clímax abre três vórtices satélites.
- Forças combinadas: tangencial, atração e sustentação; abrigo reduz vento e dano.
- Destroços orbitam o funil e o servidor emite pulsos `debris`.
- Dano só no núcleo, com queda por distância e checagem de teto.
- Recompensa: destroços com loot no rescaldo.

### Chuva de meteoros — `orbital_barrage`

- Impactos contínuos com cratera, fogo, onda de choque e pulso `impact`.
- No clímax, um meteoro gigante é anunciado por `telegraph` e cai 1,6 s depois.
- O impacto gigante abre cratera maior, arremessa jogadores e revela o **Núcleo de meteorito**.
- Contra-jogada: correr perpendicular, usar crateras como cobertura, abrigo.

### Nevasca — `whiteout`

- Vento lateral contínuo empurra jogadores expostos.
- Cada pulso causa frio, aplica `freezeUntil` e acumula neve no topo do terreno.
- Abrigo/escavação bloqueiam dano e vento; o clima cobre a ilha inteira.

### Chuva ácida — `acid_corrosion`

- Corrói o terreno, convertendo a superfície em `MAT.SLUDGE`.
- Jogadores expostos sofrem dano contínuo; abrigo bloqueia.
- No clímax, gêiseres ácidos abrem pequenas crateras e emitem `eruption`.

### Terremoto — `quake_collapse`

- Pulsos abrem fissuras, arremessam jogadores próximos e emitem `debris`.
- No clímax, uma onda sísmica de 55 m atravessa a ilha e derruba quem estiver no caminho.
- A câmera recebe tremor contínuo proporcional à distância.

### Gravidade baixa — `gravity_collapse`

- Poço gravitacional puxa jogadores e entidades para o centro.
- No clímax, a sustentação aumenta e o núcleo causa dano leve a quem ficar na anomalia.
- Poeira e destroços flutuam no cliente; o cenário fica violeta.

### Tempestade de areia — `sand_wall`

- Uma parede de areia atravessa o mapa, empurrando jogadores expostos.
- Pulsos criam dunas de `MAT.SAND` e emitem `debris`.
- No clímax, redemoinhos tangenciais giram quem estiver perto da parede.

### Tempestade de raios — `supercell`

- Raios miram jogadores, abrem crateras e emitem `lightning` com arco visível.
- Água conduz: quem estiver submerso leva dano extra e gera onda elétrica.
- No clímax, três raios caem por pulso.

### Tempestade de granizo — `hail_barrage`

- Corredor móvel de granizo gigante; o primeiro impacto de cada pulso mira um jogador exposto.
- Deixa gelo/neve no chão, arremessa e fere quem não está abrigado.
- Abrigo bloqueia completamente.

## Terreno completo — 8 assinaturas

### Erupção vulcânica — `volcano_birth`

- O vulcão nasce no centro do evento com cone coerente de basalto, escória e lava.
- Cada pulso lança bombas de lava ao redor, carveia o solo e emite `eruption`.
- No clímax, uma explosão de caldeira gera `shockwave` e o **Coração vulcânico**.
- Contra-jogada: terreno alto, sair dos vales, abrigo.

### Fissura — `canyon_tear`

- O canyon nasce no centro do evento e widen com pulsos de `debris`.
- Quem está na linha da fissura leva dano e é puxado para baixo.
- No clímax, uma ruptura perpendicular fecha o Y e gera uma onda de choque.

### Pilares de cristal — `crystal_bloom`

- Espires de cristal crescem em anel; o primeiro shard de cada pulso mira um jogador.
- Estilhaços ferem quem está perto; no clímax o anel fecha e revela o **Cristal primordial**.
- Contra-jogada: altura, escavação e sair do anel.

### Maré crescente — `tsunami_surge`

- A água sobe globalmente e pulsos de `wave` atingem áreas baixas.
- Jogadores alagados levam dano e são empurrados para o centro.
- No clímax, uma onda de 70 m varre a ilha e revela o **Cofre da maré**.

### Sorvedouro — `sinkhole_maw`

- O funil puxa jogadores e entidades para o centro e para baixo.
- Pulsos alargam a cratera e emitem `debris`.
- No clímax, o colapso abre a cratera e revela a **Relíquia do abismo** na borda.

### Rio de lava — `lava_river`

- A lava corta o mapa, ramifica e queima quem pisa nela.
- Pulsos abrem novas frentes de lava e emitem `eruption`.
- No clímax, o rio transborda e revela a **Obsidiana primordial**.

### Geleira — `glacier_advance`

- Uma parede de gelo avança de oeste para leste, congelando e empurrando quem está na frente.
- Pulsos deixam gelo/neve e emitem `hail`.
- No clímax, uma avalanche de 48 m revela o **Núcleo glacial**.

### Floresta voraz — `overgrowth_titan`

- Vinhas e raízes crescem ao redor dos jogadores e prendem os expostos.
- Pulsos criam madeira, folhas e musgo; no clímax nasce a **Árvore-Mundo**.
- A copa vira rota vertical e o centro revela a **Semente da Árvore-Mundo**.

## Entidades completo — 8 assinaturas

### Matilha Alpha — `alpha_pack`

- O primeiro spawn vira **Lobo Alpha**, com vida dobrada e escala visual maior.
- Pulsos de uivo (`roar`) curam a matilha e ferem quem está perto.
- Matar o alpha deixa a **Presa do Alpha** no último ponto conhecido.

### Colosso de Pedra — `stone_colossus`

- O golem vira **Colosso de Pedra** e pulsa pisadas sísmicas (`shockwave`).
- Jogadores próximos levam dano, knockback e são erguidos.
- A morte do colosso deixa o **Núcleo de Pedra**.

### Manada em pânico — `panic_herd`

- A manada foge em estampede e empurra quem fica no caminho.
- Pulsos de poeira (`debris`) marcam a passagem; o clímax revela a **Manada Dourada**.
- Contra-jogada: interceptar, subir ou sair da rota.

### Enxame detonante — `detonating_swarm`

- O primeiro spawn vira **Rainha Detonante**; o enxame explode em contato.
- Pulsos de explosão (`impact`) ferem em área e a rainha se cura no clímax.
- A morte da rainha deixa a **Glândula Detonante**.

### Ninho de aranhas — `spider_nest`

- Aranhas tecem e prendem jogadores próximos (`freezeUntil`).
- Pulsos de teia causam dano e lentidão; o clímax revela a **Seda da Rainha**.
- Contra-jogada: fogo, altura e sair do ninho.

### Esquadrão de caça — `hunter_squad`

- Drones pairam e disparam lasers teleguiados (`lightning`).
- Cada pulso mira o jogador mais próximo do comandante.
- A morte do **Comandante Drone** deixa o **Núcleo de Drone**.

### Titã Glacial — `ice_titan`

- O colosso de gelo aplica aura de congelamento em 14 m.
- Pulsos de granizo (`hail`) ferem e congelam; o clímax abre o **Núcleo de Gelo**.
- Contra-jogada: fogo, altura e evitar a aura.

### Ninho de víboras — `serpent_nest`

- A **Serpente Rainha** cospe veneno que cria `MAT.SLUDGE` no chão.
- Pulsos de veneno (`eruption`) ferem em área; a morte deixa o **Saco de Veneno**.
- Contra-jogada: altura, fogo e não pisar nas poças.

## Suprimentos completo — 5 assinaturas

### Chuva de suprimentos — `supply_barrage`

- Cápsulas continuam caindo em pontos aleatórios durante o evento.
- Cada impacto emite `impact` e poeira; no clímax cai a **Carga Máxima**.
- O loot fica no chão e vira disputa entre jogadores e bots.

### Arsenal blindado — `armored_depot`

- Um **Depósito Blindado** de 320 HP cai do céu e gera `shockwave` no impacto.
- A carcaça resiste a tiros e exige pressão para ser aberta.
- Recompensa: munição pesada.

### Cápsula lendária — `legendary_drop`

- Uma **Cápsula Lendária** de 260 HP desce com feixe dourado e onda `wave`.
- O brilho e o som denunciam a posição para o mapa inteiro.
- Recompensa: munição e loot de elite.

### Cofre do tesouro — `treasure_vault`

- Um **Cofre do Tesouro** emerge no chão e espalha veios de ouro pelo terreno.
- Pulsos de armadilha (`impact`) ferem quem tenta abrir sem cuidado.
- Recompensa: tesouro e munição rara.

### Resgate de emergência — `emergency_beacon`

- Um **Posto de Emergência** cria um campo de cura contínua.
- Pulsos `wave` curam e marcam a área segura no meio do caos.
- Recompensa: cura e munição para sobreviver ao próximo evento.

## Cenário completo — 6 assinaturas

### Árvore titã — `titan_tree`

- A árvore sobe em camadas, solta raízes e folhas pelo terreno e empurra quem está na base.
- Pulsos de `debris` e poeira marcam o crescimento.
- No clímax, a copa revela o **Fruto da Árvore-Mãe**.

### Labirinto verde — `maze_grove`

- Um bosque denso cresce ao redor do epicentro, criando paredes e rotas.
- Pulsos plantam madeira/folhas e emitem `debris`.
- No clímax, o centro revela o **Coração do Bosque**.

### Mansão emergente — `rising_house`

- A casa sobe do chão com porão e armadilhas.
- Pulsos de `impact` e poeira ferem quem fica na pegada.
- No clímax, o interior revela o **Baú da Mansão**.

### Torre de vigia — `watchtower`

- A torre sobe e cria uma rota vertical com visão privilegiada.
- Pulsos de `impact` empurram quem está na base.
- No topo, o clímax revela a **Relíquia da Torre**.

### Arranha-céu colossal — `colossal_tower`

- O prédio inteiro emerge, com vidro caindo e múltiplos andares.
- Pulsos de `hail` simulam os cacos; a base empurra e fere.
- No topo, o clímax revela a **Cápsula do Arranha-Céu**.

### Templo perdido — `lost_temple`

- Ruínas antigas sobem com veios de ouro e runas.
- Pulsos de `eruption` e armadilhas ferem quem pisa no santuário.
- No clímax, o altar revela a **Relíquia do Templo**.

## Relíquias de evento

Cada núcleo de evento carrega uma relíquia ativa. O jogador pega a cápsula, recebe a relíquia no inventário e ativa com o botão de ação.

| Relíquia | Efeito | Duração |
| --- | --- | --- |
| **Âncora de Vento** | Imunidade a tornado, areia e vento lateral. | 25s |
| **Máscara Ácida** | Imunidade a chuva ácida, gêiseres e veneno. | 25s |
| **Núcleo Térmico** | Imunidade a lava, fogo e bombas vulcânicas. | 25s |
| **Coração Glacial** | Imunidade a nevasca, granizo e congelamento. | 25s |
| **Para-raios** | Redireciona raios e lasers de drone. | 20s |
| **Botas Sísmicas** | Imunidade a terremoto, fissura, sorvedouro e colapso. | 25s |
| **Olho do Caos** | Enxerga através de areia/nevasca; aura de contraste. | 25s |
| **Coração de Titã** | 60 de escudo e +25 HP imediatos. | 20s |

Regras:

- O núcleo de cada evento mapeia para uma relíquia por `relicForSignature`.
- Inventário cheio derruba a relíquia no chão, sem sumir.
- O buff expira no tick autoritativo e aparece no HUD com contagem regressiva.
- O escudo de Titã é consumido antes do HP.
- Bots também buscam cápsulas de núcleo, pois são `supply_crate` normais.

## Contrato de aceite

Um evento novo ou reformulado só entra no catálogo quando:

- [ ] tem `EventSignature` exclusivo;
- [ ] tem `fun` válido e `epicScale`/`intensity` coerentes;
- [ ] tem pelo menos duas contra-jogadas;
- [ ] tem pelo menos uma reação de mundo;
- [ ] tem recompensa definida;
- [ ] emite pulsos autoritativos para o cliente;
- [ ] tem cue/loop/impacto e receita de VFX;
- [ ] tem resposta de bot;
- [ ] passa nos testes offline;
- [ ] está documentado neste arquivo e no `docs/PROTOCOL.md`.
