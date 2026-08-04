// helper_test.go — shared test utilities
package test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/gruntwork-io/terratest/modules/ssh"
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
