# ── DNS: main app A record ──────────────────────────────────────────
resource "cloudflare_record" "fuwa_a" {
  zone_id = var.cf_zone_id
  name    = var.subdomain
  value   = digitalocean_droplet.fuwa.ipv4_address
  type    = "A"
  ttl     = 1
  proxied = false # false until TLS is confirmed working via certs.fuwa
}

# IPv6 AAAA record — disabled (droplet ipv6=false)
# Re-enable when IPv6 is turned on for the droplet

# ── DNS: wildcard for tenant previews (/p/{slug}) ───────────────────
resource "cloudflare_record" "fuwa_wildcard" {
  zone_id = var.cf_zone_id
  name    = "*.${var.subdomain}"
  value   = digitalocean_droplet.fuwa.ipv4_address
  type    = "A"
  ttl     = 1
  proxied = false
}
