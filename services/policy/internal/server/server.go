package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/Azure/containerization-assist/services/policy/internal/engine"
)

const (
	// Body cap is enforced per-request via http.MaxBytesReader.
	maxBodyBytes = 1 << 20 // 1 MiB
	// Per-request evaluation budget; compile-only is bounded by the same budget.
	evalTimeout = 5 * time.Second
)

type Server struct {
	engine *engine.Engine
	mux    *http.ServeMux
}

func New(eng *engine.Engine) *Server {
	s := &Server{engine: eng, mux: http.NewServeMux()}
	s.mux.HandleFunc("/v1/healthz", s.handleHealthz)
	s.mux.HandleFunc("/v1/evaluate", s.handleEvaluate)
	s.mux.HandleFunc("/v1/compile", s.handleCompile)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "only GET supported")
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

type evaluateRequest struct {
	Rego  string      `json:"rego"`
	Input interface{} `json:"input"`
}

func (s *Server) handleEvaluate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "only POST supported")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var req evaluateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	if req.Rego == "" {
		writeError(w, http.StatusBadRequest, "MISSING_REGO", "`rego` field is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), evalTimeout)
	defer cancel()

	start := time.Now()
	result, err := s.engine.Evaluate(ctx, req.Rego, req.Input)
	if err != nil {
		var ce *engine.CompileError
		if errors.As(err, &ce) {
			writeJSON(w, http.StatusBadRequest, ce)
			return
		}
		writeError(w, http.StatusInternalServerError, "EVAL_ERROR", err.Error())
		return
	}
	result.EvaluatedInMs = time.Since(start).Milliseconds()
	writeJSON(w, http.StatusOK, result)
}

type compileRequest struct {
	Rego string `json:"rego"`
}

type compileResponse struct {
	Ok bool `json:"ok"`
}

func (s *Server) handleCompile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "only POST supported")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var req compileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	if req.Rego == "" {
		writeError(w, http.StatusBadRequest, "MISSING_REGO", "`rego` field is required")
		return
	}
	if err := s.engine.Compile(req.Rego); err != nil {
		var ce *engine.CompileError
		if errors.As(err, &ce) {
			writeJSON(w, http.StatusBadRequest, ce)
			return
		}
		writeError(w, http.StatusInternalServerError, "COMPILE_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, compileResponse{Ok: true})
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

type errBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, errBody{Code: code, Message: msg})
}
