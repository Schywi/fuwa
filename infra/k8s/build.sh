#!/usr/bin/env bash
#
# In-cluster image build for fuwa with Kaniko — no docker, no host root.
#
# Kaniko runs as a Job. It clones Schywi/fuwa at a branch *inside the cluster*,
# builds infra/Dockerfile.openresty (context = repository root), and pushes
# straight to the in-cluster registry.
#
#   infra/k8s/build.sh                       # k3s-integration + :local
#   infra/k8s/build.sh k3s-integration v2
#
# Registry address: the registry runs hostNetwork on the node (hostPort 5000),
# so a pod must reach it at the node IP, not 127.0.0.1 (a pod's loopback is the
# pod itself). Override with REGISTRY_ADDR.
set -euo pipefail

branch="${1:-k3s-integration}"
tag="${2:-local}"
repo="${REPO_URL:-https://github.com/Schywi/fuwa.git}"
registry="${REGISTRY_ADDR:-192.168.0.28:5000}"
ns="${KANIKO_NS:-registry}"
executor="${KANIKO_IMAGE:-gcr.io/kaniko-project/executor:v1.23.2}"
name="kaniko-fuwa"

git_url="git://${repo#*://}#refs/heads/${branch}"

echo "==> building fuwa @ ${branch} -> ${registry}/fuwa:${tag}"
echo "    git context: ${git_url}"

job="$(mktemp --suffix=.yaml)"
trap 'rm -f -- "${job}"' EXIT
cat >"${job}" <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: ${name}
  namespace: ${ns}
  labels:
    app.kubernetes.io/name: kaniko
    app.kubernetes.io/part-of: fuwa-lab
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 900
  template:
    metadata:
      labels:
        app.kubernetes.io/name: kaniko
    spec:
      restartPolicy: Never
      containers:
        - name: kaniko
          image: ${executor}
          args:
            - "--context=${git_url}"
            - "--dockerfile=infra/Dockerfile.openresty"
            - "--destination=${registry}/fuwa:${tag}"
            - "--insecure"
            - "--verbosity=info"
YAML

kubectl -n "${ns}" delete job "${name}" --ignore-not-found >/dev/null
kubectl apply -f "${job}"
echo "==> waiting for ${name} (up to 10m)"
if ! kubectl -n "${ns}" wait --for=condition=complete "job/${name}" --timeout=600s; then
  echo "==> build failed; last logs:" >&2
  kubectl -n "${ns}" logs "job/${name}" --tail=60 >&2 || true
  exit 1
fi
echo "==> pushed ${registry}/fuwa:${tag}"
