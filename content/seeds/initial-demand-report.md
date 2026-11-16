# Relatório de demanda

- **Gerado em:** 2026-11-16T16:17:35.163Z
- **Versão do catálogo:** 2026-11-16.2
- **Prompts enviados:** 177
- **Intenções únicas:** 70
- **Lacunas:** 42
- **Cobertura duvidosa:** 67
- **Fora do arsenal da sala:** 0 (0.0%)
- **Cobertura:** 55.4%
- **Abertos:** 177 · **Abandonados:** 0 · **Cancelados:** 0 · **Timeout:** 0
- **Demanda inicial sintética:** 354 eventos

## Intenções mais pedidas

| Intenção | Pedidos | Item | Estratégia | Exemplos |
| --- | ---: | --- | --- | --- |
| weapon: escopeta · explosiva | 9 | wpn_shotgun_fire | alias | escopeta explosiva · escopeta de fogo |
| event: chuva · meteoros | 8 | evt_weather_meteor_shower | alias | chuva de meteoros |
| weapon: gelo · pistola | 8 | wpn_pistol_ice | alias | pistola de gelo |
| weapon: plasma · rifle | 7 | wpn_rifle_standard | partial | rifle de plasma |
| event: nevasca | 6 | evt_weather_blizzard | alias | nevasca |
| weapon: fogo · metralhadora | 6 | wpn_smg_fire | tags | metralhadora de fogo · metralhadora explosiva |
| weapon: laser · sniper | 6 | wpn_sniper_standard | partial | sniper laser |
| event: erupcao · vulcanica | 5 | evt_terrain_volcano | alias | erupção vulcânica |
| event: terremoto | 5 | evt_weather_earthquake | alias | terremoto |
| weapon: bazuca · misseis | 5 | wpn_launcher_standard | partial | bazuca de mísseis |
| event: tsunami | 4 | evt_terrain_rising_tide | alias | tsunami |
| event: acida · chuva | 4 | evt_weather_acid_rain | alias | chuva ácida |
| weapon: pistola · toxica | 4 | wpn_pistol_toxic | canonical | pistola tóxica |
| weapon: arma · raio | 4 | wpn_pistol_electric | partial | arma de raio |
| weapon: acido · lancador | 4 | wpn_launcher_toxic | alias | lançador de ácido |
| event: areia · tempestade | 3 | evt_weather_meteor_shower | default | tempestade de areia |
| event: lobos · matilha | 3 | evt_entity_aggressive_nearest | alias | matilha de lobos |
| event: baixa · gravidade | 3 | evt_weather_low_gravity | alias | baixa gravidade |
| event: cristal · pilares | 3 | evt_terrain_crystal_spires | alias | pilares de cristal |
| event: chao · fissura | 3 | evt_terrain_fissure | partial | fissura no chão |
| weapon: gelo · rifle | 3 | wpn_rifle_ice | tags | rifle de gelo · rifle de cristal congelante |
| weapon: canhao · vortice | 3 | wpn_launcher_ice | partial | canhão de vórtice |
| weapon: eletrica · smg | 3 | wpn_smg_electric | tags | smg elétrica |
| weapon: precisao · rifle | 3 | wpn_sniper_standard | alias | rifle de precisão |
| event: chuva · fogo | 2 | evt_weather_meteor_shower | default | chuva de fogo |
| event: apocalipse · zumbi | 2 | evt_entity_aggressive_nearest | partial | apocalipse zumbi |
| event: criaturas · vazio | 2 | evt_entity_aggressive_nearest | partial | criaturas do vazio |
| event: drones · enxame | 2 | evt_weather_meteor_shower | default | enxame de drones |
| event: chuva · lava | 2 | evt_terrain_volcano | partial | chuva de lava |
| event: eletrica · tempestade | 2 | evt_weather_meteor_shower | default | tempestade elétrica |
| event: queda · suprimentos | 2 | evt_supply_supply | partial | queda de suprimentos |
| event: gelo · meteoros | 2 | evt_weather_meteor_shower | partial | meteoros de gelo |
| event: invasao · robos | 2 | evt_weather_meteor_shower | default | invasão de robôs |
| event: nevoeiro · toxico | 2 | evt_weather_acid_rain | partial | nevoeiro tóxico |
| event: caixa · suprimentos | 2 | evt_supply_supply | alias | caixa de suprimentos |
| event: golem · territorial | 2 | evt_entity_territorial | alias | golem territorial |
| event: enxame · kamikaze | 2 | evt_entity_explosive_kamikaze | alias | enxame kamikaze |
| weapon: gelo · lancador | 2 | wpn_launcher_ice | alias | lançador de gelo |
| weapon: gelo · metralhadora | 2 | wpn_smg_ice | alias | metralhadora de gelo |
| weapon: pistola · plasma | 2 | wpn_pistol_standard | partial | pistola de plasma |
| weapon: fuzil · incendiario | 2 | wpn_rifle_fire | tags | fuzil incendiário |
| weapon: arma · gravitacional | 2 | wpn_pistol_void | partial | arma gravitacional |
| weapon: cristal · espingarda | 2 | wpn_shotgun_standard | partial | espingarda de cristal |
| event: dourado · tesouro | 1 | evt_supply_supply | partial | tesouro dourado |
| event: infinita · municao | 1 | evt_supply_supply | partial | munição infinita |
| event: kit · medico | 1 | evt_supply_supply | partial | kit médico |
| event: armas · caixa | 1 | evt_supply_supply | partial | caixa de armas |
| event: cristal · nevasca | 1 | evt_weather_blizzard | partial | nevasca de cristal |
| event: apocaliptico · terremoto | 1 | evt_weather_earthquake | partial | terremoto apocalíptico |
| event: gemeos · vulcoes | 1 | evt_terrain_volcano | partial | vulcões gêmeos |

## Lacunas para produzir

| Intenção | Pedidos | Exemplos |
| --- | ---: | --- |
| weapon: plasma · rifle | 7 | rifle de plasma |
| weapon: laser · sniper | 6 | sniper laser |
| weapon: bazuca · misseis | 5 | bazuca de mísseis |
| weapon: arma · raio | 4 | arma de raio |
| event: areia · tempestade | 3 | tempestade de areia |
| event: chao · fissura | 3 | fissura no chão |
| weapon: canhao · vortice | 3 | canhão de vórtice |
| event: chuva · fogo | 2 | chuva de fogo |
| event: apocalipse · zumbi | 2 | apocalipse zumbi |
| event: criaturas · vazio | 2 | criaturas do vazio |
| event: drones · enxame | 2 | enxame de drones |
| event: chuva · lava | 2 | chuva de lava |
| event: eletrica · tempestade | 2 | tempestade elétrica |
| event: queda · suprimentos | 2 | queda de suprimentos |
| event: gelo · meteoros | 2 | meteoros de gelo |
| event: invasao · robos | 2 | invasão de robôs |
| event: nevoeiro · toxico | 2 | nevoeiro tóxico |
| weapon: pistola · plasma | 2 | pistola de plasma |
| weapon: arma · gravitacional | 2 | arma gravitacional |
| weapon: cristal · espingarda | 2 | espingarda de cristal |
| event: dourado · tesouro | 1 | tesouro dourado |
| event: infinita · municao | 1 | munição infinita |
| event: kit · medico | 1 | kit médico |
| event: armas · caixa | 1 | caixa de armas |
| event: cristal · nevasca | 1 | nevasca de cristal |
| event: apocaliptico · terremoto | 1 | terremoto apocalíptico |
| event: gemeos · vulcoes | 1 | vulcões gêmeos |
| event: congelado · oceano | 1 | oceano congelado |
| event: eterna · neve | 1 | neve eterna |
| event: meteoros · tempestade · terremotos | 1 | tempestade de meteoros e terremotos |
| event: arena · lava | 1 | arena de lava |
| event: floresta · toxica | 1 | floresta tóxica |
| event: fogo · tsunami | 1 | tsunami de fogo |
| event: gelo · terremoto | 1 | terremoto de gelo |
| weapon: duas · maos · pistola | 1 | pistola de duas mãos |
| weapon: arco · eletrico | 1 | arco elétrico |
| weapon: energia · espada | 1 | espada de energia |
| weapon: lancador · plasma | 1 | lançador de plasma |
| weapon: cristal · pistola | 1 | pistola de cristal |
| weapon: arma · meteoros | 1 | arma de meteoros |
| weapon: drones · rifle | 1 | rifle de drones |
| weapon: arma · fogo · gelo | 1 | arma de fogo e gelo |

## Fora do arsenal da sala (não é lacuna de catálogo)

Nenhum pedido ficou fora do pool.

## Itens mais servidos

| Item | Tipo | Usos |
| --- | --- | ---: |
| evt_weather_meteor_shower | event | 22 |
| evt_weather_blizzard | event | 10 |
| wpn_pistol_ice | weapon | 9 |
| wpn_rifle_standard | weapon | 9 |
| wpn_shotgun_fire | weapon | 9 |
| wpn_sniper_standard | weapon | 9 |
| evt_terrain_volcano | event | 9 |
| evt_supply_supply | event | 8 |
| wpn_launcher_standard | weapon | 7 |
| evt_weather_acid_rain | event | 7 |
| evt_entity_aggressive_nearest | event | 7 |
| wpn_smg_fire | weapon | 6 |
| wpn_pistol_electric | weapon | 6 |
| evt_weather_earthquake | event | 6 |
| wpn_launcher_ice | weapon | 5 |
| evt_terrain_rising_tide | event | 5 |
| wpn_launcher_toxic | weapon | 4 |
| wpn_pistol_toxic | weapon | 4 |
| wpn_pistol_standard | weapon | 4 |
| wpn_smg_electric | weapon | 3 |
| wpn_rifle_ice | weapon | 3 |
| evt_terrain_fissure | event | 3 |
| evt_terrain_crystal_spires | event | 3 |
| evt_weather_low_gravity | event | 3 |
| wpn_shotgun_standard | weapon | 2 |
| wpn_pistol_void | weapon | 2 |
| wpn_rifle_fire | weapon | 2 |
| wpn_smg_ice | weapon | 2 |
| evt_entity_explosive_kamikaze | event | 2 |
| evt_entity_territorial | event | 2 |
| wpn_rifle_toxic | weapon | 1 |
| wpn_launcher_fire | weapon | 1 |
| wpn_smg_toxic | weapon | 1 |
| wpn_rifle_void | weapon | 1 |
