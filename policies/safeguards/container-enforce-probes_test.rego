package safeguards.container_enforce_probes

# ==============================================================================
# Test Suite: container-enforce-probes
# ==============================================================================
# Tests validation that regular containers have readinessProbe and livenessProbe
# Init and ephemeral containers are excluded from validation
# ==============================================================================

# ==============================================================================
# Test: Missing both probes
# ==============================================================================

test_container_missing_both_probes if {
	test_input := {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deployment"},
				"spec": {"template": {"spec": {"containers": [{"name": "app", "image": "nginx:1.19"}]}}},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 2 # Both readiness and liveness missing

	# Check for readinessProbe violation
	some violation in result
	contains(violation.msg, "readinessProbe")
	violation.details.container == "app"
	violation.details.violationType == "missing-readiness-probe"

	# Check for livenessProbe violation
	some v1 in result
	contains(v1.msg, "livenessProbe")
	v1.details.container == "app"
	v1.details.violationType == "missing-liveness-probe"
}

# ==============================================================================
# Test: Missing only readinessProbe
# ==============================================================================

test_container_missing_readiness_probe if {
	test_input := {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deployment"},
				"spec": {"template": {"spec": {"containers": [{
					"name": "app",
					"image": "nginx:1.19",
					"livenessProbe": {"httpGet": {"path": "/health", "port": 8080}},
				}]}}},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 1

	some violation in result
	contains(violation.msg, "readinessProbe")
	violation.details.container == "app"
	violation.details.violationType == "missing-readiness-probe"
}

# ==============================================================================
# Test: Missing only livenessProbe
# ==============================================================================

test_container_missing_liveness_probe if {
	test_input := {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deployment"},
				"spec": {"template": {"spec": {"containers": [{
					"name": "app",
					"image": "nginx:1.19",
					"readinessProbe": {"httpGet": {"path": "/ready", "port": 8080}},
				}]}}},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 1

	some violation in result
	contains(violation.msg, "livenessProbe")
	violation.details.container == "app"
	violation.details.violationType == "missing-liveness-probe"
}

# ==============================================================================
# Test: Valid probes (httpGet)
# ==============================================================================

test_container_with_http_probes if {
	test_input := {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deployment"},
				"spec": {"template": {"spec": {"containers": [{
					"name": "app",
					"image": "nginx:1.19",
					"readinessProbe": {"httpGet": {"path": "/ready", "port": 8080}},
					"livenessProbe": {"httpGet": {"path": "/health", "port": 8080}},
				}]}}},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 0
}

# ==============================================================================
# Test: Valid probes (tcpSocket)
# ==============================================================================

test_container_with_tcp_probes if {
	test_input := {
		"review": {
			"object": {
				"kind": "Pod",
				"metadata": {"name": "test-pod"},
				"spec": {"containers": [{
					"name": "redis",
					"image": "redis:7",
					"readinessProbe": {"tcpSocket": {"port": 6379}},
					"livenessProbe": {"tcpSocket": {"port": 6379}},
				}]},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 0
}

# ==============================================================================
# Test: Valid probes (exec)
# ==============================================================================

test_container_with_exec_probes if {
	test_input := {
		"review": {
			"object": {
				"kind": "StatefulSet",
				"metadata": {"name": "test-statefulset"},
				"spec": {"template": {"spec": {"containers": [{
					"name": "db",
					"image": "postgres:14",
					"readinessProbe": {"exec": {"command": ["pg_isready", "-U", "postgres"]}},
					"livenessProbe": {"exec": {"command": ["pg_isready"]}},
				}]}}},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 0
}

# ==============================================================================
# Test: Valid probes (grpc)
# ==============================================================================

test_container_with_grpc_probes if {
	test_input := {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deployment"},
				"spec": {"template": {"spec": {"containers": [{
					"name": "grpc-service",
					"image": "myapp:v1",
					"readinessProbe": {"grpc": {"port": 9090}},
					"livenessProbe": {"grpc": {"port": 9090, "service": "health.v1.Health"}},
				}]}}},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 0
}

# ==============================================================================
# Test: Init containers excluded from probe checks
# ==============================================================================

test_init_containers_excluded if {
	test_input := {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deployment"},
				"spec": {"template": {"spec": {
					"initContainers": [{
						"name": "init-setup",
						"image": "busybox:1.35",
						# No probes - should not trigger violations
					}],
					"containers": [{
						"name": "app",
						"image": "nginx:1.19",
						"readinessProbe": {"httpGet": {"path": "/ready", "port": 80}},
						"livenessProbe": {"httpGet": {"path": "/health", "port": 80}},
					}],
				}}},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 0 # Init containers don't trigger violations
}

# ==============================================================================
# Test: Multiple containers with mixed probe status
# ==============================================================================

test_multiple_containers_mixed_probes if {
	test_input := {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deployment"},
				"spec": {"template": {"spec": {"containers": [
					{
						"name": "app",
						"image": "nginx:1.19",
						"readinessProbe": {"httpGet": {"path": "/ready", "port": 80}},
						"livenessProbe": {"httpGet": {"path": "/health", "port": 80}},
					},
					{
						"name": "sidecar",
						"image": "envoy:v1",
						# Missing both probes
					},
				]}}},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 2 # Both probes missing for sidecar

	# Check violations are for sidecar only
	every violation in result {
		violation.details.container == "sidecar"
	}
}

# ==============================================================================
# Test: Empty probe definitions should trigger violations
# ==============================================================================

test_empty_probe_definitions if {
	test_input := {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deployment"},
				"spec": {"template": {"spec": {"containers": [{
					"name": "app",
					"image": "nginx:1.19",
					"readinessProbe": {}, # Empty probe
					"livenessProbe": {}, # Empty probe
				}]}}},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 2 # Empty probes should trigger violations
}

# ==============================================================================
# Test: Default parameters when not specified
# ==============================================================================

test_default_parameters if {
	test_input := {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deployment"},
				"spec": {"template": {"spec": {"containers": [{"name": "app", "image": "nginx:1.19"}]}}},
			},
		},
		# No parameters specified - should use defaults
	}

	result := violations with input as test_input
	count(result) == 2 # Should enforce both probes by default
}

# ==============================================================================
# Test: Ephemeral containers REQUIRE probes (helper includes them)
# ==============================================================================

test_ephemeral_containers_require_probes if {
	test_input := {
		"review": {
			"object": {
				"kind": "Pod",
				"metadata": {"name": "test-pod"},
				"spec": {
					"containers": [{
						"name": "app",
						"image": "nginx:1.19",
						"readinessProbe": {"httpGet": {"path": "/ready", "port": 80}},
						"livenessProbe": {"httpGet": {"path": "/health", "port": 80}},
					}],
					"ephemeralContainers": [{
						"name": "debugger",
						"image": "busybox:1.35",
						# No probes - SHOULD trigger violations per get_regular_containers
					}],
				},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 2 # Ephemeral containers ARE checked by get_regular_containers

}

# ==============================================================================
# Test: Pod without template structure (direct Pod)
# ==============================================================================

test_direct_pod_spec if {
	test_input := {
		"review": {
			"object": {
				"kind": "Pod",
				"metadata": {"name": "test-pod"},
				"spec": {"containers": [{
					"name": "app",
					"image": "nginx:1.19",
					# Missing probes
				}]},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe", "livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 2 # Both probes missing
}

# ==============================================================================
# Test: Only enforce readinessProbe when specified
# ==============================================================================

test_enforce_only_readiness_probe if {
	test_input := {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deployment"},
				"spec": {"template": {"spec": {"containers": [{
					"name": "app",
					"image": "nginx:1.19",
					"livenessProbe": {"httpGet": {"path": "/health", "port": 80}},
					# Missing readinessProbe
				}]}}},
			},
		},
		"parameters": {"enforceProbes": ["readinessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 1

	some violation in result
	contains(violation.msg, "readinessProbe")
	violation.details.violationType == "missing-readiness-probe"
}

# ==============================================================================
# Test: Only enforce livenessProbe when specified
# ==============================================================================

test_enforce_only_liveness_probe if {
	test_input := {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deployment"},
				"spec": {"template": {"spec": {"containers": [{
					"name": "app",
					"image": "nginx:1.19",
					"readinessProbe": {"httpGet": {"path": "/ready", "port": 80}},
					# Missing livenessProbe
				}]}}},
			},
		},
		"parameters": {"enforceProbes": ["livenessProbe"]},
	}

	result := violations with input as test_input
	count(result) == 1

	some violation in result
	contains(violation.msg, "livenessProbe")
	violation.details.violationType == "missing-liveness-probe"
}
