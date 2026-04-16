package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Azure/containerization-assist/services/policy/internal/engine"
)

func newTestServer() *Server { return New(engine.New(16)) }

func doJSON(t *testing.T, srv *Server, method, path string, body interface{}) (*http.Response, []byte) {
	t.Helper()
	var rdr *bytes.Buffer
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		rdr = bytes.NewBuffer(b)
	} else {
		rdr = bytes.NewBuffer(nil)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	resp := rec.Result()
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(resp.Body)
	return resp, buf.Bytes()
}

func TestHealthz(t *testing.T) {
	srv := newTestServer()
	resp, body := doJSON(t, srv, http.MethodGet, "/v1/healthz", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if string(body) != "ok" {
		t.Fatalf("expected body 'ok', got %q", string(body))
	}
}

func TestHealthz_RejectsPost(t *testing.T) {
	srv := newTestServer()
	resp, _ := doJSON(t, srv, http.MethodPost, "/v1/healthz", nil)
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", resp.StatusCode)
	}
}

func TestCompile_ValidReturnsOk(t *testing.T) {
	srv := newTestServer()
	req := map[string]string{"rego": "package t\n\nallow := true"}
	resp, body := doJSON(t, srv, http.MethodPost, "/v1/compile", req)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", resp.StatusCode, body)
	}
	var out map[string]bool
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !out["ok"] {
		t.Fatalf("expected ok=true, got %+v", out)
	}
}

func TestCompile_InvalidReturns400WithLine(t *testing.T) {
	srv := newTestServer()
	req := map[string]string{"rego": "package t\n\nallow := @@"}
	resp, body := doJSON(t, srv, http.MethodPost, "/v1/compile", req)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", resp.StatusCode, body)
	}
	var ce map[string]interface{}
	if err := json.Unmarshal(body, &ce); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if ce["line"] == nil {
		t.Fatalf("expected line in error payload, got %+v", ce)
	}
}

func TestCompile_MissingRegoReturns400(t *testing.T) {
	srv := newTestServer()
	resp, body := doJSON(t, srv, http.MethodPost, "/v1/compile", map[string]string{})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "MISSING_REGO") {
		t.Fatalf("expected MISSING_REGO error, got %s", body)
	}
}

func TestEvaluate_ProducesViolations(t *testing.T) {
	srv := newTestServer()
	req := map[string]interface{}{
		"rego":  "package t\n\nviolations contains {\"rule\":\"r\",\"message\":\"m\"} if input.bad == true",
		"input": map[string]bool{"bad": true},
	}
	resp, body := doJSON(t, srv, http.MethodPost, "/v1/evaluate", req)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.StatusCode, body)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	vs, _ := out["violations"].([]interface{})
	if len(vs) != 1 {
		t.Fatalf("expected 1 violation, got %+v", out["violations"])
	}
}

func TestEvaluate_InvalidJSONReturns400(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{not json"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestEvaluate_BodyTooLargeIsRejected(t *testing.T) {
	srv := newTestServer()
	big := strings.Repeat("a", (1<<20)+16)
	payload := map[string]string{"rego": "package t\n\nallow := true", "input": big}
	resp, _ := doJSON(t, srv, http.MethodPost, "/v1/evaluate", payload)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 on oversize body, got %d", resp.StatusCode)
	}
}

func TestEvaluate_RejectsGet(t *testing.T) {
	srv := newTestServer()
	resp, _ := doJSON(t, srv, http.MethodGet, "/v1/evaluate", nil)
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", resp.StatusCode)
	}
}
