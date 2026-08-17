# ── Firewall: only expose what OpenResty serves ─────────────────────
# All internal ports (8123, 8428, 8686, 8687, 4317, 4318, 9000, 9181)
# are container-network only, never exposed to the internet.

resource "digitalocean_firewall" "fuwa" {
  name        = "fuwa-${var.subdomain}"
  droplet_ids = [digitalocean_droplet.fuwa.id]

  # SSH — restrict to your IP in production
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # HTTP (Let's Encrypt HTTP-01 challenge)
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # HTTPS
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # OpenResty app port
  inbound_rule {
    protocol         = "tcp"
    port_range       = "8080"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # Allow ICMP (ping) for debugging
  inbound_rule {
    protocol         = "icmp"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # Allow all outbound (Docker pulls, git, apt, Let's Encrypt)
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
