#!/usr/bin/env bash
set -euo pipefail

# ── cilium-lab.sh — ephemeral Cilium + Hubble playground via k3d ─────
#
# Commands:
#   up       Create k3d cluster, install Cilium + Hubble, deploy demo pods
#   down     Delete the k3d cluster (everything else is untouched)
#   status   Show cluster health, memory, URLs
#
# Hubble UI after up:  http://localhost:8080/dash/hubble/
# (served through OpenResty; port 30080 is mapped from k3d)

CLUSTER_NAME="${CLUSTER_NAME:-cilium-lab}"
HUBBLE_NODE_PORT="${HUBBLE_NODE_PORT:-30080}"
CILIUM_OPERATOR_REPLICAS="${CILIUM_OPERATOR_REPLICAS:-1}"
OPENRESTY_NETWORK="${OPENRESTY_NETWORK:-docker-compose_default}"
HUBBLE_PROXY_ALIAS="${HUBBLE_PROXY_ALIAS:-hubble-ui}"
K3D_VERSION="v5.7.5"
CILIUM_CLI_VERSION="v0.18.0"
BIN_DIR="${HOME}/.local/bin"

# ── helpers ──────────────────────────────────────────────────────────

green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*"; }

log() { echo "[cilium-lab] $*"; }

ensure_k3d() {
    if command -v k3d &>/dev/null; then return; fi
    log "installing k3d ${K3D_VERSION} ..."
    mkdir -p "$BIN_DIR"
    curl -fsSL "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-amd64" \
        -o "$BIN_DIR/k3d"
    chmod +x "$BIN_DIR/k3d"
    export PATH="$BIN_DIR:$PATH"
}

ensure_cilium_cli() {
    if command -v cilium &>/dev/null; then return; fi
    log "installing cilium CLI ${CILIUM_CLI_VERSION} ..."
    mkdir -p "$BIN_DIR"
    local arch=amd64
    curl -fsSL "https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-linux-${arch}.tar.gz" \
        | tar xz -C "$BIN_DIR" cilium
}

cilium_install_args() {
    printf '%s\n' \
        upgrade \
        --install \
        cilium \
        cilium/cilium \
        --namespace \
        kube-system \
        --set \
        "operator.replicas=${CILIUM_OPERATOR_REPLICAS}" \
        --set \
        hubble.relay.enabled=true \
        --set \
        hubble.ui.enabled=true \
        --set \
        hubble.ui.service.type=NodePort \
        --set \
        "hubble.ui.service.nodePort=${HUBBLE_NODE_PORT}" \
        --wait \
        --timeout \
        5m
}

k3d_serverlb_container() {
    printf 'k3d-%s-serverlb\n' "$CLUSTER_NAME"
}

hubble_proxy_connect_args() {
    printf '%s\n' \
        network \
        connect \
        --alias \
        "$HUBBLE_PROXY_ALIAS" \
        "$OPENRESTY_NETWORK" \
        "$(k3d_serverlb_container)"
}

bridge_hubble_proxy() {
    if ! command -v docker &>/dev/null; then
        return 0
    fi

    local serverlb
    serverlb="$(k3d_serverlb_container)"
    if ! docker ps --format '{{.Names}}' | grep -qx "$serverlb"; then
        return 0
    fi

    local connect_args=()
    mapfile -t connect_args < <(hubble_proxy_connect_args)
    docker "${connect_args[@]}" 2>/dev/null || true
}

# ── commands ─────────────────────────────────────────────────────────

cmd_up() {
    ensure_k3d
    ensure_cilium_cli

    if k3d cluster list 2>/dev/null | grep -q "^${CLUSTER_NAME} "; then
        yellow "cluster '${CLUSTER_NAME}' already exists"
        bridge_hubble_proxy
        cmd_status
        return 0
    fi

    green "🔧 Creating k3d cluster '${CLUSTER_NAME}' ..."
    k3d cluster create "$CLUSTER_NAME" \
        --k3s-arg "--disable=traefik@server:0" \
        --k3s-arg "--flannel-backend=none@server:0" \
        -p "${HUBBLE_NODE_PORT}:${HUBBLE_NODE_PORT}@server:0"
    bridge_hubble_proxy

    green "📦 Installing Cilium + Hubble ..."
    helm repo add cilium https://helm.cilium.io/ 2>/dev/null || true
    helm repo update >/dev/null 2>&1
    local helm_args=()
    mapfile -t helm_args < <(cilium_install_args)
    helm "${helm_args[@]}"

    green "⏳ Waiting for Cilium to be ready ..."
    cilium status --wait --wait-duration=3m

    green "📊 Deploying demo pods ..."
    kubectl create deployment nginx --image=nginx:alpine --dry-run=client -o yaml | kubectl apply -f -
    kubectl create deployment curl --image=curlimages/curl -- sleep 3600 --dry-run=client -o yaml | kubectl apply -f -
    kubectl create deployment evil --image=curlimages/curl -- sleep 3600 --dry-run=client -o yaml | kubectl apply -f -

    log "waiting for pods to be ready ..."
    kubectl wait --for=condition=ready pod -l app=nginx --timeout=60s 2>/dev/null || true
    kubectl wait --for=condition=ready pod -l app=curl --timeout=60s 2>/dev/null || true
    kubectl wait --for=condition=ready pod -l app=evil --timeout=60s 2>/dev/null || true

    sleep 5

    green "🚀 Generating traffic ..."
    local nginx_pod; nginx_pod=$(kubectl get pods -l app=nginx -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
    if [ -n "$nginx_pod" ]; then
        kubectl exec deploy/curl -- curl -sf http://"$nginx_pod" > /dev/null 2>&1 || true
        kubectl exec deploy/evil -- curl -sf http://"$nginx_pod" > /dev/null 2>&1 || true
    fi

    echo ""
    green "✅ Cilium lab is ready!"
    echo ""
    echo "  Hubble UI:   http://localhost:${HUBBLE_NODE_PORT}"
    echo "  Via nginx:   http://localhost:8080/dash/hubble/"
    echo ""
    echo "  Hubble CLI:  hubble observe --namespace default"
    echo ""
    echo "  Memory usage:"
    cmd_memory
    echo ""
    echo "  To teardown: $0 down"
}

cmd_down() {
    if ! k3d cluster list 2>/dev/null | grep -q "^${CLUSTER_NAME} "; then
        yellow "cluster '${CLUSTER_NAME}' not found"
        return 0
    fi
    green "🗑️  Deleting k3d cluster '${CLUSTER_NAME}' ..."
    k3d cluster delete "$CLUSTER_NAME"
    green "done"
}

cmd_status() {
    ensure_k3d 2>/dev/null || true
    ensure_cilium_cli 2>/dev/null || true

    if ! k3d cluster list 2>/dev/null | grep -q "^${CLUSTER_NAME} "; then
        red "cluster '${CLUSTER_NAME}' not running"
        echo "  run: $0 up"
        return 1
    fi

    echo "Cluster: $(k3d cluster list 2>/dev/null | grep "^${CLUSTER_NAME} " || echo '?')"
    echo ""
    echo "Cilium:"
    cilium status --brief 2>/dev/null || echo "  (cilium CLI not available)"
    echo ""
    echo "Pods:"
    kubectl get pods -A --field-selector=status.phase=Running 2>/dev/null | head -20 || echo "  (kubectl error)"
    echo ""
    cmd_memory
}

cmd_memory() {
    if ! command -v docker &>/dev/null; then
        echo "  (docker not available)"
        return
    fi
    local k3d_containers
    k3d_containers=$(docker ps --format '{{.Names}} {{.MemUsage}}' 2>/dev/null | grep k3d-"$CLUSTER_NAME" || true)
    if [ -z "$k3d_containers" ]; then
        echo "  (no k3d containers running)"
        return
    fi
    echo "  k3d container memory:"
    echo "$k3d_containers" | while read -r name mem; do
        printf '    %-40s %s\n' "$name" "$mem"
    done
}

# ── main ─────────────────────────────────────────────────────────────

main() {
    local cmd="${1:-status}"
    case "$cmd" in
        up)       cmd_up ;;
        down)     cmd_down ;;
        status)   cmd_status ;;
        *)        echo "usage: $0 {up|down|status}"; exit 1 ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
