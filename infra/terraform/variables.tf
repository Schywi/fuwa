# ── Required ────────────────────────────────────────────────────────
variable "do_token" {
  description = "DigitalOcean API token (https://cloud.digitalocean.com/account/api/tokens)"
  type        = string
  sensitive   = true
}

variable "cf_api_token" {
  description = "Cloudflare API token with Zone.DNS edit permission"
  type        = string
  sensitive   = true
}

variable "cf_zone_id" {
  description = "Cloudflare Zone ID (found in Overview sidebar)"
  type        = string
  default     = ""
}

# ── Domain ──────────────────────────────────────────────────────────
variable "domain" {
  description = "Base domain (e.g. fuwa.io). Creates fuwa.<domain> and *.<domain>"
  type        = string
  default     = ""
}

variable "subdomain" {
  description = "Subdomain prefix (default: fuwa → fuwa.<domain>)"
  type        = string
  default     = "fuwa"
}

# ── SSH ─────────────────────────────────────────────────────────────
variable "ssh_key_name" {
  description = "Name of an existing DO SSH key, or leave empty to upload from fingerprint"
  type        = string
  default     = ""
}

variable "ssh_public_key" {
  description = "Path to SSH public key to upload if not using existing DO key"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

# ── Droplet ─────────────────────────────────────────────────────────
variable "droplet_region" {
  description = "DigitalOcean region"
  type        = string
  default     = "nyc3"
}

variable "droplet_size" {
  description = "Droplet size (4GB RAM minimum for ClickHouse)"
  type        = string
  default     = "s-2vcpu-4gb"
}

# ── Fuwa ────────────────────────────────────────────────────────────
variable "fuwa_branch" {
  description = "Git branch to deploy"
  type        = string
  default     = "ui-redesign-sqlite-implementation-infra-merge"
}

variable "fuwa_email" {
  description = "Email for Let's Encrypt certificate"
  type        = string
  default     = "admin@fuwa.local"
}
