// helper_test.go — shared test utilities
package test

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gruntwork-io/terratest/modules/ssh"
	"github.com/gruntwork-io/terratest/modules/terraform"
)

func loadKeyPair(t *testing.T) *ssh.KeyPair {
	t.Helper()

	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("cannot find home directory: %v", err)
	}

	keyPath := filepath.Join(home, ".ssh", "id_ed25519")
	if _, err := os.Stat(keyPath); os.IsNotExist(err) {
		keyPath = filepath.Join(home, ".ssh", "id_rsa")
	}

	keyPair, err := ssh.LoadKeyPair(keyPath, "")
	if err != nil {
		t.Fatalf("cannot load SSH key from %s: %v", keyPath, err)
	}

	return keyPair
}

func terraformOptions() *terraform.Options {
	return &terraform.Options{
		TerraformDir: "../",
	}
}

func waitForHTTP(t *testing.T, url string, wantStatus int) {
	t.Helper()

	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Timeout: 5 * time.Second,
	}

	deadline := time.Now().Add(2 * time.Minute)
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil && resp != nil {
			resp.Body.Close()
			if resp.StatusCode == wantStatus {
				return
			}
		}
		time.Sleep(5 * time.Second)
	}

	t.Fatalf("timed out waiting for %s to return %d", url, wantStatus)
}
