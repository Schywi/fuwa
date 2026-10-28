# fuwa in k3s

Deploys the fuwa OpenResty runtime as a single pod in the `fuwa` namespace, on
the native-k3s profile (Cilium, Cilium LB IPAM). Reachable at its own
LoadBalancer IP: **http://192.168.0.244/**.

## Build the image

The image is built in-cluster by Kaniko — no docker, no host root — from the
**current working tree**. Kaniko runs as a pod and can't see this checkout, so
the build script uploads the repo into a builder pod and builds from
`dir:///workspace`. No GitHub remote or branch involved.

```bash
infra/k8s/build.sh local
```

The tag defaults to `sha-<short git sha>` and is written into
`app/kustomization.yaml`, so the manifests always point at the image that was
actually pushed. Commit that file to deploy — see *Deploy* below.

## Deploy

Two kustomizations, deliberately separate so a prune can never reach the log
store:

```bash
kubectl apply -k infra/k8s/app            # runtime: namespace, rbac, deployment, service, netpol
kubectl apply -k infra/k8s/observability  # loki, tempo, otel-collector (+ its netpol)
```

### Through Argo CD (the intended path)

`infra/k8s/argocd/application.yaml` is the canonical Application. The k3s
repository (`experiments`) holds the Argo instance and applies its Applications
from `config/argocd/applications/`, so copy that file there as `fuwa.yaml`:

```bash
kubectl apply -f experiments/config/argocd/applications/fuwa.yaml
```

From then on deploys are commits, not `kubectl` calls:

```bash
infra/k8s/build.sh                 # pushes :sha-<sha> and pins it in app/kustomization.yaml
git add infra/k8s/app/kustomization.yaml && git commit -m 'deploy: fuwa sha-<sha>'
```

`selfHeal` reverts hand edits, including `kubectl set image` and
`kubectl rollout restart`; the image tag in git is the only lever.

| Path | What |
| --- | --- |
| `app/namespace.yaml` | the isolated `fuwa` namespace (`Prune=false`) |
| `app/rbac.yaml` | ServiceAccount + namespace-scoped Role for `pods` / `pods/log` only |
| `app/deployment.yaml` | the runtime pod (`replicas: 1`, `FUWA_K8S=true`, `FUWA_SSL=false`, `ASSISTANT_UPSTREAM`, `ARGOCD_UPSTREAM`) |
| `app/service.yaml` | `LoadBalancer` on the Cilium lan-pool IP `192.168.0.244` |
| `app/networkpolicy.yaml` | Cilium allow-list: ingress from the LB; egress to the API server, DNS, observability, the assistant (`8080`) and argocd-server (`8080`, the pod port — Cilium applies egress policy after DNAT) |
| `observability/` | loki (+ PVC, `Prune=false`), tempo, otel-collector and their netpol |
| `argocd/application.yaml` | the Application that renders `app/` |

Isolation: everything is namespaced to `fuwa`; the only cluster API access is
read-only pod list + pod log, so the workload cannot modify other namespaces.

## Pod logs in tmux

The tmux panel streams Kubernetes pod logs. `runtime/openresty/pods_live.lua`
resolves each slot's label selector to a pod and tails it through the API using
the pod's ServiceAccount. Slots are declared in
`shell/views/fragments/home.fuwa` (`data-tmux-slot` + `data-tmux-selector`).

## Tracing

Traces flow: fuwa OTLP → `otel-collector` → `tempo` → Grafana.

```bash
kubectl apply -f infra/k8s/observability/tempo.yaml
kubectl apply -f infra/k8s/observability/otel-collector.yaml
```

Add a Tempo datasource to Grafana (the `config/grafana` chart in the
experiments repo). In that chart's values, extend `datasource` to a list, or add
a second datasource entry:

```yaml
- name: Tempo
  type: tempo
  url: http://tempo.observability.svc.cluster.local:3200
```

The deployment already points `FUWA_SIGNOZ_OTLP_URL` at
`http://otel-collector.observability.svc.cluster.local:4318/v1/traces`.

## Dashboard buttons

The shell's Observability header links to the cluster dashboards:
`Grafana ↗` opens the Grafana panel (`http://grafana.home.arpa/`) and
`Cilium ↗` opens the Hubble UI (`http://hubble.home.arpa/`). Both names resolve
to the shared Cilium ingress LB via the LAN resolver (see the experiments
repo's `config/dns`).

## Argo CD panel

Argo refuses to be framed (`X-Frame-Options: sameorigin` plus
`CSP frame-ancestors 'self'`) and its page hardcodes `<base href="/">`. nginx
therefore proxies it at `/argocd/`, drops both headers, rewrites the base and
proxies the bundle's absolute `/api/v1` calls, which is what lets the shell's
**Argo CD ⛵** button open it in a fuwa panel instead of a tab.
