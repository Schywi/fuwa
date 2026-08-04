# ── SSH key ──────────────────────────────────────────────────────────
data "digitalocean_ssh_key" "fuwa" {
  count = var.ssh_key_name != "" ? 1 : 0
  name  = var.ssh_key_name
}

resource "digitalocean_ssh_key" "fuwa" {
  count      = var.ssh_key_name == "" ? 1 : 0
  name       = "fuwa-${var.subdomain}"
  public_key = file(pathexpand(var.ssh_public_key))
}

locals {
  ssh_key_id = var.ssh_key_name != "" ? data.digitalocean_ssh_key.fuwa[0].id : digitalocean_ssh_key.fuwa[0].id
}

# ── Volume for ClickHouse data ──────────────────────────────────────
resource "digitalocean_volume" "clickhouse" {
  region                  = var.droplet_region
  name                    = "fuwa-clickhouse-${var.subdomain}"
  size                    = 10
  description             = "ClickHouse persistent storage for ${var.subdomain}.${var.domain}"
  filesystem_type         = "ext4"
  initial_filesystem_type = "ext4"
}

# ── Droplet ─────────────────────────────────────────────────────────
resource "digitalocean_droplet" "fuwa" {
  image    = "ubuntu-24-04-x64"
  name     = "fuwa-${var.subdomain}"
  region   = var.droplet_region
  size     = var.droplet_size
  ssh_keys = [local.ssh_key_id]
  user_data = templatefile("${path.module}/cloudinit.yml", {
    domain      = "${var.subdomain}.${var.domain}"
    email       = var.fuwa_email
    fuwa_branch = var.fuwa_branch
  })

  volume_ids = [digitalocean_volume.clickhouse.id]
}
