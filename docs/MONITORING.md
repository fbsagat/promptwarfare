# Monitoramento: Docker + Prometheus + Grafana + Uptime Kuma

Esta API roda como container `pw_api` na mesma VPS da stack **MemeTrigger**, que já fornece Prometheus, Grafana, Loki/Alloy, Alertmanager e Uptime Kuma. A integração é por **rede Docker + scrape interno**, sem publicar `/metrics` na internet.

## Topologia

```text
Internet
  └── nginx (mt_gateway) ── api.promptwarfare.com / ws ──▶ pw_api:3000
                                                             │
Prometheus (mt_prometheus) ── scrape /metrics ───────────────┘
Grafana (mt_grafana) ── dashboard provisionado
Uptime Kuma (mt_uptime) ── GET /api/health
```

- Container: `pw_api`
- Rede: `memetrigger_default` (ou o nome definido em `MONITORING_NETWORK`)
- Porta interna: `3000`
- Porta publicada no host: **nenhuma** (o nginx faz o proxy)
- `/metrics`: interno, sem autenticação; **não** publique pelo nginx
- `/api/health`: usado pelo healthcheck e pelo Uptime Kuma
- `/api/metrics`: JSON agregado, com `METRICS_TOKEN` opcional

## Subir a API

No diretório do projeto Prompt Warfare:

```bash
cp .env.example .env
# Ajuste CORS_ORIGINS, PROMPT_LEDGER_BACKEND, PROMPT_LEDGER_POSTGRES_URL etc.
docker network ls | grep memetrigger
docker compose -f docker-compose.prod.yml up -d --build
docker logs -f pw_api
```

O compose usa rede externa:

```yaml
networks:
  monitoring:
    external: true
    name: ${MONITORING_NETWORK:-memetrigger_default}
```

Se o projeto da stack principal não se chamar `memetrigger`, defina `MONITORING_NETWORK` no ambiente do compose.

Volumes:

- `promptwarfare_data:/app/data` — ledger SQLite;
- `./content/catalog:/app/content/catalog:ro` — hot reload do catálogo;
- `./content/assets:/app/content/assets:ro` — manifesto de assets.

## Endpoint Prometheus

`GET /metrics` em `text/plain; version=0.0.4`.

O job no `memetrigger/monitoring/prometheus/prometheus.yml` é:

```yaml
- job_name: promptwarfare
  static_configs:
    - targets: ["pw_api:3000"]
  metrics_path: /metrics
```

O relabel do Netdata adiciona `stack="promptwarfare"` a containers `pw_*`, permitindo que o alerta existente `ContainerDown` cubra a API.

### Métricas expostas

| Métrica | Tipo | Descrição |
| --- | --- | --- |
| `promptwarfare_up` | gauge | API respondendo (sempre 1 quando o scrape funciona) |
| `promptwarfare_uptime_seconds` | gauge | Uptime do processo |
| `promptwarfare_metrics_generated_at_seconds` | gauge | Timestamp do snapshot do ledger |
| `promptwarfare_rooms{state}` | gauge | Salas total/playing/lobby |
| `promptwarfare_players{kind}` | gauge | Humanos/bots conectados |
| `promptwarfare_catalog_info{version}` | gauge | Versão do catálogo |
| `promptwarfare_assets_info{version}` | gauge | Versão do manifesto |
| `promptwarfare_ledger_backend_info{backend}` | gauge | `sqlite`/`postgres` |
| `promptwarfare_prompts_submitted` | gauge | Prompts humanos na janela |
| `promptwarfare_coverage_ratio` | gauge | Cobertura de catálogo (0..1) |
| `promptwarfare_partial_prompts` | gauge | Cobertura duvidosa |
| `promptwarfare_catalog_gaps` | gauge | Lacunas de catálogo |
| `promptwarfare_pool_misses` | gauge | Pedidos fora do pool |
| `promptwarfare_pool_miss_ratio` | gauge | Proporção de pool miss |
| `promptwarfare_loop_versions` | gauge | Versões observadas |
| `promptwarfare_items{kind}` | gauge | Itens com demanda/uso |
| `promptwarfare_gap_status{status}` | gauge | Fechadas/persistentes/regredidas |
| `promptwarfare_alert_active{code,severity}` | gauge | Alerta agregado ativo |

A janela do snapshot é `METRICS_WINDOW_DAYS` (padrão 90); o refresh é a cada 60 s. Salas/uptime são lidos ao vivo no scrape.

## Alertas Prometheus

Grupo `promptwarfare` em `memetrigger/monitoring/prometheus/alerts/rules.yml`:

| Alerta | Condição | Severidade |
| --- | --- | --- |
| `PromptWarfareDown` | `up{job="promptwarfare"} == 0` por 2m | critical |
| `PromptWarfareCoverageLow` | cobertura < 35% com ≥ 20 prompts | warning |
| `PromptWarfarePoolMissHigh` | pool miss > 35% com ≥ 20 prompts | warning |
| `PromptWarfareRegressedGaps` | lacunas regredidas > 0 por 5m | critical |
| `PromptWarfareMetricsStale` | `/metrics` responde mas snapshot > 5m | warning |

Após alterar regras/config:

```bash
docker kill -s HUP mt_prometheus
# ou: curl -X POST http://127.0.0.1:9090/-/reload
```

## Grafana

Dashboard provisionado automaticamente:

- arquivo: `memetrigger/monitoring/grafana/provisioning/dashboards/promptwarfare.json`
- UID: `promptwarfare-visao-geral`
- pasta: `MemeTrigger`
- datasource: `prometheus`

O provisionamento recarrega em até 30 s; não precisa reiniciar o Grafana. Painéis: API up, uptime, salas, jogadores, cobertura, pool miss, lacunas, regredidas, itens com uso, versão do catálogo, série temporal e tabela de alertas ativos.

## Uptime Kuma

O Uptime Kuma 2.5.x **não expõe API REST para criar monitores**; use a UI:

1. Acesse `http://<IP-Tailscale>:3001`.
2. **Add New Monitor**.
3. Tipo HTTP(s), intervalo 60 s.
4. URL interna: `http://pw_api:3000/api/health` ou pública: `https://<api-pública>/api/health`.
5. Esperado: HTTP 200.
6. Associe ao canal de notificação existente (`Telegram ops`).

Para TLS do domínio público, use um monitor de certificado separado, como os já existentes.

## Postgres

Opcional, para múltiplas instâncias:

```sql
CREATE USER promptwarfare WITH PASSWORD '<senha-forte>';
CREATE DATABASE promptwarfare OWNER promptwarfare;
```

```dotenv
PROMPT_LEDGER_BACKEND=postgres
PROMPT_LEDGER_POSTGRES_URL=postgresql://promptwarfare:<senha>@postgres:5432/promptwarfare
```

A imagem Docker já instala `pg`. As tabelas são criadas no boot. Salas continuam em memória; use sticky sessions/afinidade por sala se rodar mais de uma instância.

## Troubleshooting

| Sintoma | Verificar |
| --- | --- |
| `PromptWarfareDown` | `docker ps` mostra `pw_api`? `docker logs pw_api`; `docker exec mt_prometheus wget -qO- http://pw_api:3000/metrics` |
| `ContainerDown` sem stack | Relabel do Netdata em `prometheus.yml`; container deve se chamar `pw_*` |
| Dashboard vazio | Datasource `prometheus` e job `promptwarfare` no Prometheus |
| `PromptWarfareMetricsStale` | Ledger travado, refresh de 60 s falhando ou processo sem acesso ao banco |
| `pool_miss_ratio` alto | Pool pequeno/núcleo errado; revisar `server/contentPool.ts` |
| Cobertura baixa | Rodar `npm run loop:report`, revisar lacunas e promover candidatos |
| Uptime Kuma não alcança | Containers na mesma rede? use `pw_api:3000`; não use `localhost` |
| `/metrics` acessível publicamente | Remover location do nginx; é interno |

## Segurança

- `/metrics` não tem token porque só é alcançável pela rede Docker; não publique.
- `/api/metrics` pode ser protegido por `METRICS_TOKEN` (`X-Metrics-Token`).
- O container roda como usuário `node`, com `cap_drop: ALL` e `no-new-privileges`.
- O volume SQLite é escrito apenas pelo entrypoint (chown para `node`).
- Não reutilize o banco `memetrigger` para o ledger do Prompt Warfare.
