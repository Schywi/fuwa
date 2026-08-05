# nginx.conf — variable-based proxy_pass fix

## Problem

`host not found in upstream "signoz"` on line 74. Nginx resolves static `proxy_pass http://signoz:8080` at config parse time. If signoz isn't running yet, nginx refuses to start. Works locally (fast machine), breaks on VPS (slower boot).

## Fix

Replace static `proxy_pass http://host:port` with variable-based `proxy_pass http://$upstream_name`. Variable-based resolution happens at **request time** via the already-configured `resolver 127.0.0.11`.

## File to edit: `nginx.conf`

### Change 1 — line 72-79: SigNoz dashboard

Replace:

```nginx
        # ── SigNoz dashboard ──
        location /dash/signoz/ {
            proxy_pass http://signoz:8080;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
```

With:

```nginx
        # ── SigNoz dashboard ──
        location /dash/signoz/ {
            set $signoz_upstream signoz:8080;
            proxy_pass http://$signoz_upstream;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
```

### Change 2 — line 81-92: SigNoz API (guarded)

Replace:

```nginx
        # ── SigNoz API (guarded to dashboard referers) ──
        location /api/ {
            if ($signoz_api_allowed = 0) {
                return 404;
            }
            rewrite ^/api/?(.*)$ /dash/signoz/api/$1 break;
            proxy_pass http://signoz:8080;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
```

With:

```nginx
        # ── SigNoz API (guarded to dashboard referers) ──
        location /api/ {
            if ($signoz_api_allowed = 0) {
                return 404;
            }
            rewrite ^/api/?(.*)$ /dash/signoz/api/$1 break;
            set $signoz_upstream signoz:8080;
            proxy_pass http://$signoz_upstream;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
```

### Change 3 — line 94-98: VictoriaMetrics

Replace:

```nginx
        # ── VictoriaMetrics ──
        location /dash/vmetrics/ {
            rewrite ^/dash/vmetrics(/.*)$ $1 break;
            proxy_pass http://victoriametrics:8428;
        }
```

With:

```nginx
        # ── VictoriaMetrics ──
        location /dash/vmetrics/ {
            rewrite ^/dash/vmetrics(/.*)$ $1 break;
            set $vm_upstream victoriametrics:8428;
            proxy_pass http://$vm_upstream;
        }
```

### Change 4 — line 100-104: ClickHouse Play UI

Replace:

```nginx
        # ── ClickHouse Play UI ──
        location /dash/clickhouse/ {
            rewrite ^/dash/clickhouse(/.*)$ $1 break;
            proxy_pass http://signoz-clickhouse:8123;
        }
```

With:

```nginx
        # ── ClickHouse Play UI ──
        location /dash/clickhouse/ {
            rewrite ^/dash/clickhouse(/.*)$ $1 break;
            set $ch_upstream signoz-clickhouse:8123;
            proxy_pass http://$ch_upstream;
        }
```

### Change 5 — line 106-110: Vector API

Replace:

```nginx
        # ── Vector API ──
        location /dash/vector/ {
            rewrite ^/dash/vector(/.*)$ $1 break;
            proxy_pass http://vector-router:8686;
        }
```

With:

```nginx
        # ── Vector API ──
        location /dash/vector/ {
            rewrite ^/dash/vector(/.*)$ $1 break;
            set $vec_upstream vector-router:8686;
            proxy_pass http://$vec_upstream;
        }
```

## How it works

- `set $signoz_upstream signoz:8080` — sets nginx variable, no DNS lookup yet
- `proxy_pass http://$signoz_upstream` — nginx sees a variable → defers DNS to request time → uses `resolver 127.0.0.11` → Docker DNS returns current container IP
- First request gets 502 if upstream isn't ready yet (instead of nginx crashing)
- Once upstream boots, next request resolves and works
- Docker DNS cache: `valid=10s` means IP updates within 10s of container restart

## Why this is safe

- `proxy_http_version 1.1` still works
- `proxy_set_header` still works
- `rewrite` in VictoriaMetrics/ClickHouse/Vector locations still works (rewrite runs before proxy_pass)
- Resolver already configured on line 22: `resolver 127.0.0.11 valid=10s ipv6=off`
- Zero Lua, zero new dependencies, pure nginx feature since 1.5.x
