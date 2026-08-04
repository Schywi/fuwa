// http_test.go — verify all endpoints respond correctly
package test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
)

func TestEndpointsReachable(t *testing.T) {
	opts := terraformOptions()
	defer terraform.Destroy(t, opts)
	terraform.InitAndApply(t, opts)

	ip := terraform.Output(t, opts, "droplet_ip")
	base := fmt.Sprintf("http://%s:8080", ip)

	waitForHTTP(t, base+"/", 200)

	tests := []struct {
		name       string
		endpoint   string
		wantStatus int
	}{
		{"fuwa app", "/", 200},
		{"signoz dashboard", "/dash/signoz/", 302},
		{"victoria metrics", "/dash/vmetrics/", 200},
		{"clickhouse ui", "/dash/clickhouse/", 200},
		{"vector api", "/dash/vector/", 200},
		{"traces endpoint", "/__dev/traces", 200},
		{"health", "/", 200},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			url := base + tt.endpoint
			client := &http.Client{
				CheckRedirect: func(req *http.Request, via []*http.Request) error {
					return http.ErrUseLastResponse // don't follow redirects
				},
			}
			resp, err := client.Get(url)
			assert.NoError(t, err, "GET %s", url)
			if resp != nil {
				defer resp.Body.Close()
				assert.Equal(t, tt.wantStatus, resp.StatusCode,
					"%s: expected %d, got %d", url, tt.wantStatus, resp.StatusCode)
			}
		})
	}
}
