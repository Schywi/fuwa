# fuwa ↔ cluster observability wiring

These belong to the **experiments** repo but are applied from here because the
Reasonix file-tool sandbox only writes under `fuwa/`, and Grafana/VictoriaMetrics
are Argo CD-managed with `selfHeal` (out-of-band edits to *their own* objects are
reverted).

## Applied from here

`fuwa-observability-netpol.yaml` — two **additive** CiliumNetworkPolicies
(Cilium unions policies selecting the same endpoint):
- `fuwa-metrics-remote-write` (observability): VictoriaMetrics accepts the fuwa
  collector's remote-write on 8428.
- `fuwa-observability-read` (observability): Grafana reaches fuwa's Tempo (3200)
  and Loki (3100).

Grafana datasources `Tempo` and `Loki` were added through the Grafana API
(persisted in Grafana's DB). They are **not** yet in Git.

## To move to the experiments repo

1. `config/victoriametrics/templates/ciliumnetworkpolicy.yaml` — add to
   `spec.ingress`:
   ```yaml
   - fromEndpoints:
       - matchLabels:
           k8s:io.kubernetes.pod.namespace: fuwa
     toPorts:
       - ports:
           - port: "8428"
             protocol: TCP
   ```
2. `config/grafana/templates/ciliumnetworkpolicy.yaml` — add to `spec.egress`:
   ```yaml
   - toEndpoints:
       - matchLabels:
           k8s:io.kubernetes.pod.namespace: fuwa
     toPorts:
       - ports:
           - port: "3200"
             protocol: TCP
           - port: "3100"
             protocol: TCP
   ```
3. `config/grafana/values.yaml` + `config/grafana/templates/configmap-datasources.yaml`
   — replace the API-added datasources with provisioned ones:
   ```yaml
   extraDatasources:
     - { name: Tempo, uid: tempo, type: tempo, url: http://tempo.fuwa.svc.cluster.local:3200 }
     - { name: Loki,  uid: loki,  type: loki,  url: http://loki.fuwa.svc.cluster.local:3100 }
   ```
   and range `extraDatasources` in the datasources ConfigMap template.

Once those land, delete `fuwa-observability-netpol.yaml` (except the fuwa-side
`networkpolicy.yaml`, which stays).
