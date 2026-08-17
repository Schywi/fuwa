output "droplet_ip" {
  description = "Droplet public IPv4 address"
  value       = digitalocean_droplet.fuwa.ipv4_address
}

output "droplet_ipv6" {
  description = "Droplet public IPv6 address"
  value       = digitalocean_droplet.fuwa.ipv6_address
}

output "fqdn" {
  description = "Fully qualified domain name"
  value       = "${var.subdomain}.${var.domain}"
}

output "signoz_url" {
  description = "SigNoz dashboard URL"
  value       = "http://${var.subdomain}.${var.domain}:8080/dash/signoz/"
}

output "ansible_inventory" {
  description = "Copy this line into ansible/inventory.yml"
  value       = <<-EOT
    all:
      hosts:
        fuwa:
          ansible_host: ${digitalocean_droplet.fuwa.ipv4_address}
          ansible_user: root
  EOT
}
