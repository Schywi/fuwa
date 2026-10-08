#!/usr/bin/env bash
#
# In-cluster image build for fuwa with Kaniko, from the CURRENT repository
# state — no git remote, no branch, no push.
#
# Kaniko runs as a pod and cannot see this working tree, so the build context
# is uploaded into a builder pod and kaniko builds from dir:///workspace.
#
#   infra/k8s/build.sh            # tag :local
#   infra/k8s/build.sh v2
#
# Registry address: the registry runs hostNetwork on the node (hostPort 5000),
# so a pod must reach it at the node IP, not 127.0.0.1 (a pod's loopback is the
# pod itself). Override with REGISTRY_ADDR.
set -euo pipefail

tag="${1:-local}"
registry="${REGISTRY_ADDR:-192.168.0.28:5000}"
ns="${KANIKO_NS:-registry}"
image="${KANIKO_IMAGE:-gcr.io/kaniko-project/executor:v1.23.2}"
# The -debug variant ships a shell + tar, needed to receive the uploaded context.
builder_image="${image%-debug}-debug"
pod="kaniko-fuwa-ctx"

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

cleanup() {
  kubectl -n "${ns}" delete pod "${pod}" --ignore-not-found --wait=false >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> building fuwa (current working tree) -> ${registry}/fuwa:${tag}"
echo "    context: dir:///workspace  (from ${repo_root})"

kubectl -n "${ns}" delete pod "${pod}" --ignore-not-found --wait=true >/dev/null
kubectl -n "${ns}" apply -f - <<YAML
apiVersion: v1
kind: Pod
metadata:
  name: ${pod}
  labels:
    app.kubernetes.io/name: kaniko
    app.kubernetes.io/part-of: fuwa-lab
spec:
  restartPolicy: Never
  containers:
    - name: builder
      image: ${builder_image}
      command: ["sh", "-c", "sleep 3600"]
YAML

kubectl -n "${ns}" wait --for=condition=Ready "pod/${pod}" --timeout=180s

# Upload the current tree (kaniko applies .dockerignore during COPY).
kubectl -n "${ns}" exec "${pod}" -- mkdir -p /workspace
tar -C "${repo_root}" \
  --exclude=.git --exclude=.fuwa-dev --exclude=node_modules \
  -cf - . | kubectl -n "${ns}" exec -i "${pod}" -- tar -C /workspace -xf -

# Build and push straight from the uploaded context.
kubectl -n "${ns}" exec "${pod}" -- /kaniko/executor \
  --context=dir:///workspace \
  --dockerfile=infra/Dockerfile.openresty \
  --destination="${registry}/fuwa:${tag}" \
  --insecure \
  --verbosity=info

echo "==> pushed ${registry}/fuwa:${tag}"
