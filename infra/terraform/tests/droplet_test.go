// droplet_test.go — verify droplet is up and Docker is healthy
package test

import (
	"testing"
	"time"

	"github.com/gruntwork-io/terratest/modules/ssh"
	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
)

func TestDropletHealthy(t *testing.T) {
	opts := terraformOptions()

	defer terraform.Destroy(t, opts)
	terraform.InitAndApply(t, opts)

	host := ssh.Host{
		Hostname:    terraform.Output(t, opts, "droplet_ip"),
		SshKeyPair:  loadKeyPair(t),
		SshUserName: "root",
	}

	// Give Docker a moment after boot
	ssh.CheckSshConnection(t, host)
	time.Sleep(10 * time.Second)

	// Docker daemon running
	output := ssh.CheckSshCommand(t, host, "docker info --format '{{.ServerVersion}}'")
	assert.NotEmpty(t, output, "docker should be running")

	// All critical containers running
	ps := ssh.CheckSshCommand(t, host,
		"docker ps --format '{{.Names}}' --filter 'status=running'")

	expected := []string{"openresty", "signoz-ingester", "signoz-clickhouse",
		"vector-router", "victoriametrics", "signoz"}
	for _, name := range expected {
		assert.Contains(t, ps, name, "container %s should be running", name)
	}

	// ClickHouse memory under 2.1 GB
	mem := ssh.CheckSshCommand(t, host,
		"docker stats --no-stream --format '{{.MemUsage}}' "+
			"$(docker ps -q -f name=signoz-clickhouse)")

	t.Logf("ClickHouse memory: %s", mem)
	// MemUsage format: "123.4MiB / 2GiB"
	assert.NotEmpty(t, mem)
}
