package safeguards.pod_enforce_antiaffinity

# ==============================================================================
# Pod Anti-Affinity Test Suite
# ==============================================================================
#
# Comprehensive tests for validating pod anti-affinity configuration following
# Azure Draft specification. Tests cover:
# - Multi-replica without antiaffinity → violation
# - Multi-replica with podAntiAffinity → pass
# - Multi-replica with topologySpreadConstraints → pass
# - Single replica → pass (no violation)
# - Empty podAntiAffinity {} → pass (existence check)
# - Different resource kinds (Deployment, StatefulSet, DaemonSet)
#
# Run with: opa test policies/safeguards/pod-enforce-antiaffinity_test.rego -v
#
# ==============================================================================

import data.safeguards.lib as lib

# ==============================================================================
# Test Fixtures - Input Objects
# ==============================================================================

# Multi-replica Deployment without antiaffinity
deployment_multi_no_antiaffinity := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {
		"replicas": 3,
		"template": {"spec": {
			"containers": [{"name": "app", "image": "nginx:1.21"}]
		}}
	}
}

# Multi-replica Deployment with podAntiAffinity
deployment_multi_with_antiaffinity := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {
		"replicas": 3,
		"template": {"spec": {
			"containers": [{"name": "app", "image": "nginx:1.21"}],
			"affinity": {
				"podAntiAffinity": {
					"requiredDuringSchedulingIgnoredDuringExecution": [{
						"labelSelector": {"matchLabels": {"app": "test"}},
						"topologyKey": "kubernetes.io/hostname"
					}]
				}
			}
		}}
	}
}

# Multi-replica Deployment with empty podAntiAffinity {} (existence check)
deployment_multi_empty_antiaffinity := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {
		"replicas": 3,
		"template": {"spec": {
			"containers": [{"name": "app", "image": "nginx:1.21"}],
			"affinity": {
				"podAntiAffinity": {}
			}
		}}
	}
}

# Multi-replica Deployment with topologySpreadConstraints
deployment_multi_with_topology := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {
		"replicas": 3,
		"template": {"spec": {
			"containers": [{"name": "app", "image": "nginx:1.21"}],
			"topologySpreadConstraints": [{
				"maxSkew": 1,
				"topologyKey": "kubernetes.io/hostname",
				"whenUnsatisfiable": "DoNotSchedule",
				"labelSelector": {"matchLabels": {"app": "test"}}
			}]
		}}
	}
}

# Single replica Deployment without antiaffinity
deployment_single_no_antiaffinity := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {
		"replicas": 1,
		"template": {"spec": {
			"containers": [{"name": "app", "image": "nginx:1.21"}]
		}}
	}
}

# Multi-replica Deployment with both podAntiAffinity and topologySpreadConstraints
deployment_multi_with_both := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {
		"replicas": 3,
		"template": {"spec": {
			"containers": [{"name": "app", "image": "nginx:1.21"}],
			"affinity": {
				"podAntiAffinity": {
					"preferredDuringSchedulingIgnoredDuringExecution": [{
						"weight": 100,
						"podAffinityTerm": {
							"labelSelector": {"matchLabels": {"app": "test"}},
							"topologyKey": "kubernetes.io/hostname"
						}
					}]
				}
			},
			"topologySpreadConstraints": [{
				"maxSkew": 1,
				"topologyKey": "kubernetes.io/hostname",
				"whenUnsatisfiable": "DoNotSchedule",
				"labelSelector": {"matchLabels": {"app": "test"}}
			}]
		}}
	}
}

# StatefulSet with multi-replica without antiaffinity
statefulset_multi_no_antiaffinity := {
	"kind": "StatefulSet",
	"metadata": {"name": "test-db"},
	"spec": {
		"replicas": 3,
		"template": {"spec": {
			"containers": [{"name": "db", "image": "postgres:13"}]
		}}
	}
}

# StatefulSet with multi-replica and topologySpreadConstraints
statefulset_multi_with_topology := {
	"kind": "StatefulSet",
	"metadata": {"name": "test-db"},
	"spec": {
		"replicas": 3,
		"template": {"spec": {
			"containers": [{"name": "db", "image": "postgres:13"}],
			"topologySpreadConstraints": [{
				"maxSkew": 1,
				"topologyKey": "kubernetes.io/hostname",
				"whenUnsatisfiable": "DoNotSchedule",
				"labelSelector": {"matchLabels": {"app": "test-db"}}
			}]
		}}
	}
}

# Deployment with replicas = 2 (edge case for > 1)
deployment_replicas_2_no_antiaffinity := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {
		"replicas": 2,
		"template": {"spec": {
			"containers": [{"name": "app", "image": "nginx:1.21"}]
		}}
	}
}

# Deployment without replicas field (defaults to 1)
deployment_no_replicas_field := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {
		"template": {"spec": {
			"containers": [{"name": "app", "image": "nginx:1.21"}]
		}}
	}
}

# ==============================================================================
# Helper Functions for Tests
# ==============================================================================

# Build full input object with review
build_input(resource) := {"review": {"object": resource}}

# ==============================================================================
# Tests - Violations (Multi-replica without antiaffinity)
# ==============================================================================

test_violation_multi_replica_no_antiaffinity if {
	test_input := build_input(deployment_multi_no_antiaffinity)
	results := violations with input as test_input
	count(results) > 0
	
	# Verify violation message mentions replicas
	some violation in results
	contains(violation.message, "3")
	contains(violation.message, "podAntiAffinity")
	contains(violation.message, "topologySpreadConstraints")
}

test_violation_statefulset_multi_no_antiaffinity if {
	test_input := build_input(statefulset_multi_no_antiaffinity)
	results := violations with input as test_input
	count(results) > 0
	
	# Verify it applies to StatefulSet
	some violation in results
	contains(violation.message, "3")
}

test_violation_replicas_2_edge_case if {
	test_input := build_input(deployment_replicas_2_no_antiaffinity)
	results := violations with input as test_input
	count(results) > 0
	
	# Verify violation for replicas = 2 (> 1)
	some violation in results
	violation.replicas == 2
}

# ==============================================================================
# Tests - No Violations (Multi-replica with antiaffinity)
# ==============================================================================

test_no_violation_with_pod_antiaffinity if {
	test_input := build_input(deployment_multi_with_antiaffinity)
	results := violations with input as test_input
	count(results) == 0
}

test_no_violation_with_empty_pod_antiaffinity if {
	test_input := build_input(deployment_multi_empty_antiaffinity)
	results := violations with input as test_input
	count(results) == 0
}

test_no_violation_with_topology_spread if {
	test_input := build_input(deployment_multi_with_topology)
	results := violations with input as test_input
	count(results) == 0
}

test_no_violation_with_both_antiaffinity_methods if {
	test_input := build_input(deployment_multi_with_both)
	results := violations with input as test_input
	count(results) == 0
}

test_no_violation_statefulset_with_topology if {
	test_input := build_input(statefulset_multi_with_topology)
	results := violations with input as test_input
	count(results) == 0
}

# ==============================================================================
# Tests - Single Replica (No Violations)
# ==============================================================================

test_no_violation_single_replica if {
	test_input := build_input(deployment_single_no_antiaffinity)
	results := violations with input as test_input
	count(results) == 0
}

test_no_violation_default_replicas_omitted if {
	test_input := build_input(deployment_no_replicas_field)
	results := violations with input as test_input
	count(results) == 0
}

# ==============================================================================
# Tests - Violation Attributes
# ==============================================================================

test_violation_has_required_fields if {
	test_input := build_input(deployment_multi_no_antiaffinity)
	results := violations with input as test_input
	count(results) > 0
	
	some violation in results
	# Verify required fields
	violation.rule == "pod-enforce-antiaffinity"
	violation.message != ""
	violation.replicas == 3
}
