# ClickHouse crash loop + SigNoz v1 API — fixes

## Symptom 1: ClickHouse crash loop

```
BAD_ARGUMENTS: number_of_free_entries_in_pool_to_execute_mutation (20)
is greater than background_pool_size×background_merges_mutations_concurrency_ratio (0)
```

Root cause: `background_merges_mutations_concurrency_ratio: 0` → `1×0=0` available mutation slots. ClickHouse defaults expect 20. Config parser rejects this. Crash loop.

### Fix: `clickhouse-config-0-0.yaml`

Change:

```yaml
background_pool_size: 1
background_merges_mutations_concurrency_ratio: 0
```

To:

```yaml
background_pool_size: 1
background_merges_mutations_concurrency_ratio: 1
```

And add under `merge_tree:`:

```yaml
number_of_free_entries_in_pool_to_execute_mutation: 1
```

Now `1×1=1 ≥ 1` → config passes. Mutations still effectively disabled (pool of 1, no one schedules them), but ClickHouse starts.
 

Add these to the Ansible fuwa role as a post-bootstrap task, or run them manually once.

### Memory: hard cap at 1GB

In `clickhouse-config-0-0.yaml`, add after `listen_host`:

```yaml
max_server_memory_usage: 1073741824
max_server_memory_usage_to_ram_ratio: 0.25
```

And in `profiles.default`:

```yaml
max_memory_usage: 536870912
max_threads: 1
```

This gives ClickHouse 1GB server max, 512MB per query. Caches auto-lower to ~500MB. With 3-hour TTL, data never accumulates enough to need merges. Background pool of 1 with no merges = ClickHouse is a write-only buffer that forgets everything after 3 hours.

## Symptom 3: SigNoz v1 dashboard API deprecated

SigNoz `latest` on VPS is newer than local. v1 endpoints return deprecation errors. Two fixes:

### Option A: Pin SigNoz version (simplest)

In `signoz.yml`, change:

```yaml
signoz:
  image: signoz/signoz-community:latest
```

To the version that matches your local cache:

```yaml
signoz:
  image: signoz/signoz-community:0.71.0
```

Or whatever version `docker image inspect signoz/signoz-community:latest` shows locally.
 
 
## Apply order on the VPS

```bash
# 1. Fix ClickHouse config (the crash loop fix)
#    Edit clickhouse-config-0-0.yaml → restart signoz-clickhouse

# 2. Fix SigNoz version
#    Pin image tag in signoz.yml → docker compose up -d signoz
 