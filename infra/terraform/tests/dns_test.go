// dns_test.go — verify DNS records resolve to the droplet IP
package test

import (
	"net"
	"testing"

	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
)

func TestDNSPropagated(t *testing.T) {
	opts := terraformOptions()
	defer terraform.Destroy(t, opts)
	terraform.InitAndApply(t, opts)

	dropletIP := terraform.Output(t, opts, "droplet_ip")
	fqdn := terraform.Output(t, opts, "fqdn")

	// Main A record
	ips, err := net.LookupHost(fqdn)
	assert.NoError(t, err, "DNS lookup for %s", fqdn)
	assert.Contains(t, ips, dropletIP, "%s should resolve to %s", fqdn, dropletIP)

	// Wildcard record
	wildcardHost := "preview." + fqdn
	wildIPs, err := net.LookupHost(wildcardHost)
	assert.NoError(t, err, "DNS lookup for %s", wildcardHost)
	assert.Contains(t, wildIPs, dropletIP, "%s should resolve to %s", wildcardHost, dropletIP)
}
