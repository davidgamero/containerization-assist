package engine

import (
	"context"
	"strings"
	"testing"
)

const validRego = `package test

violations contains {"rule": "no-latest", "message": "use a specific tag"} if contains(input.content, ":latest")

warnings contains {"rule": "prefer-mcr", "message": "prefer mcr.microsoft.com"} if contains(input.content, "docker.io")
`

func TestEvaluate_ProducesViolations(t *testing.T) {
	eng := New(16)
	res, err := eng.Evaluate(context.Background(), validRego, map[string]interface{}{"content": "FROM node:latest"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Violations) != 1 || res.Violations[0].Rule != "no-latest" {
		t.Fatalf("expected one no-latest violation, got %+v", res.Violations)
	}
	if len(res.Warnings) != 0 {
		t.Fatalf("expected no warnings, got %+v", res.Warnings)
	}
}

func TestEvaluate_ProducesWarnings(t *testing.T) {
	eng := New(16)
	res, err := eng.Evaluate(context.Background(), validRego, map[string]interface{}{"content": "FROM docker.io/node:20"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Violations) != 0 {
		t.Fatalf("expected no violations, got %+v", res.Violations)
	}
	if len(res.Warnings) != 1 || res.Warnings[0].Rule != "prefer-mcr" {
		t.Fatalf("expected one prefer-mcr warning, got %+v", res.Warnings)
	}
}

func TestEvaluate_NoMatches(t *testing.T) {
	eng := New(16)
	res, err := eng.Evaluate(context.Background(), validRego, map[string]interface{}{"content": "FROM mcr.microsoft.com/node:20"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Violations) != 0 || len(res.Warnings) != 0 {
		t.Fatalf("expected clean run, got violations=%+v warnings=%+v", res.Violations, res.Warnings)
	}
}

func TestEvaluate_CacheHitOnSecondCall(t *testing.T) {
	eng := New(16)
	ctx := context.Background()
	first, err := eng.Evaluate(ctx, validRego, map[string]interface{}{"content": "FROM node:20"})
	if err != nil {
		t.Fatalf("first eval failed: %v", err)
	}
	if first.CacheHit {
		t.Fatalf("first eval should be a cache miss")
	}
	second, err := eng.Evaluate(ctx, validRego, map[string]interface{}{"content": "FROM node:latest"})
	if err != nil {
		t.Fatalf("second eval failed: %v", err)
	}
	if !second.CacheHit {
		t.Fatalf("second eval should be a cache hit")
	}
	if len(second.Violations) != 1 {
		t.Fatalf("cached prepared query must still produce correct results, got %+v", second.Violations)
	}
}

func TestEvaluate_CacheDisabled(t *testing.T) {
	eng := New(0)
	res, err := eng.Evaluate(context.Background(), validRego, map[string]interface{}{"content": "FROM node:20"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.CacheHit {
		t.Fatalf("cache disabled, expected CacheHit=false")
	}
	again, err := eng.Evaluate(context.Background(), validRego, map[string]interface{}{"content": "FROM node:20"})
	if err != nil {
		t.Fatalf("unexpected error on second call: %v", err)
	}
	if again.CacheHit {
		t.Fatalf("cache disabled, second call should also be miss")
	}
}

func TestCompile_ValidModule(t *testing.T) {
	eng := New(0)
	if err := eng.Compile(validRego); err != nil {
		t.Fatalf("valid module should compile, got: %v", err)
	}
}

func TestCompile_ParseErrorSurfacesLineCol(t *testing.T) {
	eng := New(0)
	err := eng.Compile("package test\n\nviolations contains @@@")
	if err == nil {
		t.Fatal("expected parse error")
	}
	ce, ok := err.(*CompileError)
	if !ok {
		t.Fatalf("expected *CompileError, got %T", err)
	}
	if ce.Line == 0 {
		t.Fatalf("expected line info on parse error, got %+v", ce)
	}
}

func TestEvaluate_MissingPackageIsCompileError(t *testing.T) {
	eng := New(0)
	_, err := eng.Evaluate(context.Background(), "violations contains {\"rule\":\"x\"} if true", nil)
	if err == nil {
		t.Fatal("expected error on missing package declaration")
	}
	ce, ok := err.(*CompileError)
	if !ok || ce.Code != "MISSING_PACKAGE" {
		t.Fatalf("expected MISSING_PACKAGE CompileError, got %T %+v", err, err)
	}
}

func TestExtractPackage_IgnoresCommentsAndWhitespace(t *testing.T) {
	pkg, err := extractPackage("# preamble\n\n  package  foo.bar\n\nviolations contains {} if true\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if pkg != "foo.bar" {
		t.Fatalf("expected foo.bar, got %q", pkg)
	}
}

func TestDecodeViolations_SkipsMalformedEntries(t *testing.T) {
	in := []interface{}{
		map[string]interface{}{"rule": "r1", "message": "m1"},
		"not-an-object",
		map[string]interface{}{"message": "m2"},
		map[string]interface{}{"rule": 42, "message": "m3"},
	}
	out := decodeViolations(in)
	if len(out) != 3 {
		t.Fatalf("expected 3 decoded entries (non-object dropped), got %d: %+v", len(out), out)
	}
	if out[0].Rule != "r1" || out[1].Rule != "" || out[2].Rule != "" {
		t.Fatalf("unexpected decoded rules: %+v", out)
	}
	if !strings.Contains(out[0].Message, "m1") {
		t.Fatalf("expected m1 in first message, got %q", out[0].Message)
	}
}

func TestSha256Hex_DeterministicAndDifferent(t *testing.T) {
	a := sha256Hex("hello")
	b := sha256Hex("hello")
	c := sha256Hex("world")
	if a != b {
		t.Fatal("sha256Hex must be deterministic")
	}
	if a == c {
		t.Fatal("distinct inputs must produce distinct hashes")
	}
	if len(a) != 64 {
		t.Fatalf("expected 64 hex chars, got %d", len(a))
	}
}
