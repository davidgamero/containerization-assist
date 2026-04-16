package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/open-policy-agent/opa/ast"
	"github.com/open-policy-agent/opa/rego"
)

// Engine wraps OPA Rego evaluation for the policy sidecar.
// Holds an LRU cache of prepared (parsed + compiled + query-optimized) modules
// so hot policies skip the ~1-5ms parse/compile path entirely on subsequent evals.
type Engine struct {
	cache *lru.Cache[string, rego.PreparedEvalQuery]
}

// New constructs an Engine with a compile cache of the given size.
// size <= 0 disables caching.
func New(size int) *Engine {
	if size <= 0 {
		return &Engine{}
	}
	cache, err := lru.New[string, rego.PreparedEvalQuery](size)
	if err != nil {
		return &Engine{}
	}
	return &Engine{cache: cache}
}

// Violation / Warning shapes mirror src/http/types.ts PolicyViolation.
// They are decoded from the Rego module's `violations` and `warnings` rules.
type Violation struct {
	Rule    string `json:"rule"`
	Message string `json:"message"`
	Path    string `json:"path,omitempty"`
}

type EvalResult struct {
	Violations    []Violation `json:"violations"`
	Warnings      []Violation `json:"warnings"`
	Raw           interface{} `json:"raw,omitempty"`
	EvaluatedInMs int64       `json:"evaluatedInMs"`
	CacheHit      bool        `json:"cacheHit"`
}

// CompileError describes a parse/compile-time Rego failure with source location
// so the UI can highlight the offending line.
type CompileError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Line    int    `json:"line,omitempty"`
	Col     int    `json:"col,omitempty"`
}

func (e *CompileError) Error() string { return e.Message }

// Compile parses and type-checks the given Rego source without evaluating.
// Returns a CompileError with line/col on failure.
func (e *Engine) Compile(src string) error {
	module, err := ast.ParseModuleWithOpts("policy.rego", src, ast.ParserOptions{RegoVersion: ast.RegoV1})
	if err != nil {
		return toCompileError(err)
	}
	compiler := ast.NewCompiler()
	compiler.Compile(map[string]*ast.Module{"policy.rego": module})
	if compiler.Failed() {
		return toCompileError(compiler.Errors)
	}
	return nil
}

// Evaluate prepares (or reuses cached preparation of) the Rego module and evaluates
// it against the given input. The module MUST declare `violations` and/or `warnings`
// rules producing objects with at least `rule` and `message` fields.
// Missing rules are treated as empty sets.
func (e *Engine) Evaluate(ctx context.Context, src string, input interface{}) (*EvalResult, error) {
	prepared, cacheHit, err := e.prepare(ctx, src)
	if err != nil {
		return nil, err
	}

	rs, err := prepared.Eval(ctx, rego.EvalInput(input))
	if err != nil {
		return nil, toCompileError(err)
	}

	res := &EvalResult{
		Violations: []Violation{},
		Warnings:   []Violation{},
		CacheHit:   cacheHit,
	}
	if len(rs) == 0 {
		return res, nil
	}

	pkgData, ok := rs[0].Expressions[0].Value.(map[string]interface{})
	if !ok {
		return res, nil
	}
	res.Raw = pkgData
	res.Violations = decodeViolations(pkgData["violations"])
	res.Warnings = decodeViolations(pkgData["warnings"])
	return res, nil
}

func (e *Engine) prepare(ctx context.Context, src string) (rego.PreparedEvalQuery, bool, error) {
	key := sha256Hex(src)

	if e.cache != nil {
		if prepared, ok := e.cache.Get(key); ok {
			return prepared, true, nil
		}
	}

	pkg, err := extractPackage(src)
	if err != nil {
		return rego.PreparedEvalQuery{}, false, err
	}

	query := fmt.Sprintf("data.%s", pkg)
	r := rego.New(
		rego.Query(query),
		rego.Module("policy.rego", src),
		rego.SetRegoVersion(ast.RegoV1),
	)
	prepared, err := r.PrepareForEval(ctx)
	if err != nil {
		return rego.PreparedEvalQuery{}, false, toCompileError(err)
	}

	if e.cache != nil {
		e.cache.Add(key, prepared)
	}
	return prepared, false, nil
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func decodeViolations(v interface{}) []Violation {
	out := []Violation{}
	arr, ok := v.([]interface{})
	if !ok {
		return out
	}
	for _, item := range arr {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		out = append(out, Violation{
			Rule:    stringOr(m, "rule", ""),
			Message: stringOr(m, "message", ""),
			Path:    stringOr(m, "path", ""),
		})
	}
	return out
}

func stringOr(m map[string]interface{}, k, fallback string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return fallback
}

func extractPackage(src string) (string, error) {
	for _, line := range strings.Split(src, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "package ") {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, "package")), nil
		}
	}
	return "", &CompileError{Code: "MISSING_PACKAGE", Message: "rego module missing `package` declaration"}
}

func toCompileError(err error) *CompileError {
	if err == nil {
		return nil
	}
	// ast.Errors is a slice with detailed Location info per error.
	if errs, ok := err.(ast.Errors); ok && len(errs) > 0 {
		first := errs[0]
		ce := &CompileError{
			Code:    string(first.Code),
			Message: first.Message,
		}
		if first.Location != nil {
			ce.Line = first.Location.Row
			ce.Col = first.Location.Col
		}
		return ce
	}
	return &CompileError{Code: "COMPILE_ERROR", Message: err.Error()}
}
