# fuwa in k3s

Deploys the fuwa OpenResty runtime as a single pod in the `fuwa` namespace, on
the native-k3s profile (Cilium, Cilium LB IPAM). Reachable at its own
LoadBalancer IP: **http://192.168.0.244/**.

## Build the image

The image is built in-cluster by Kaniko — no docker, no host root. It clones
`Schywi/fuwa` at a branch, builds `infra/Dockerfile.openresty`, and pushes to
the in-cluster registry.

```bash
infra/k8s/build.sh k3s-integration local
```

> Precondition: the branch must exist on GitHub (`Schywi/fuwa`). Kaniko clones
> the remote branch, so push `k3s-integration` first.

Update loop: re-run `build.sh`, then `kubectl -n fuwa rollout restart deployment/fuwa`.

## Deploy

```bash
kubectl apply -f infra/k8s/namespace.yaml
kubectl apply -f infra/k8s/rbac.yaml
kubectl apply -f infra/k8s/deployment.yaml
kubectl apply -f infra/k8s/service.yaml
kubectl apply -f infra/k8s/networkpolicy.yaml
```

| File | What |
| --- | --- |
| `namespace.yaml` | the isolated `fuwa` namespace |
| `rbac.yaml` | ServiceAccount + namespace-scoped Role for `pods` / `pods/log` only |
| `deployment.yaml` | the runtime pod (`replicas: 1`, `FUWA_K8S=true`, `FUWA_SSL=false`) |
| `service.yaml` | `LoadBalancer` on the Cilium lan-pool IP `192.168.0.244` |
| `networkpolicy.yaml` | Cilium allow-list: ingress from the LB; egress to the API server, DNS, and observability |

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
