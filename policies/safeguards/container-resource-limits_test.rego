package safeguards.container_resource_limits

# ==============================================================================
# Container Resource Limits Test Suite
# ==============================================================================
#
# Comprehensive tests for validating container resource limits following
# Azure Draft specification. Tests cover:
# - Missing CPU/memory limits
# - Limits exceeding maximum values
# - Valid limits (passing scenarios)
# - Init containers and ephemeral containers
# - Excluded containers by name
# - Excluded containers by image prefix
# - Multiple violations in single pod
#
# Run with: opa test policies/safeguards/ -v --filter resource-limits
#
# ==============================================================================

import data.safeguards.lib as lib

# ==============================================================================
# Test Fixtures - Input Objects
# ==============================================================================

# Deployment with no resource limits
deployment_no_limits := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {"template": {"spec": {"containers": [{
		"name": "app",
		"image": "nginx:1.21",
	}]}}},
}

# Deployment with missing CPU limit
deployment_missing_cpu := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {"template": {"spec": {"containers": [{
		"name": "app",
		"image": "nginx:1.21",
		"resources": {"limits": {"memory": "256Mi"}},
	}]}}},
}

# Deployment with missing memory limit
deployment_missing_memory := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {"template": {"spec": {"containers": [{
		"name": "app",
		"image": "nginx:1.21",
		"resources": {"limits": {"cpu": "500m"}},
	}]}}},
}

# Deployment with valid limits (within max)
deployment_valid_limits := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {"template": {"spec": {"containers": [{
		"name": "app",
		"image": "nginx:1.21",
		"resources": {"limits": {
			"cpu": "500m",
			"memory": "256Mi",
		}},
	}]}}},
}

# Deployment with CPU limit exceeding max
deployment_cpu_exceeds := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {"template": {"spec": {"containers": [{
		"name": "app",
		"image": "nginx:1.21",
		"resources": {"limits": {
			"cpu": "9000m",
			"memory": "256Mi",
		}},
	}]}}},
}

# Deployment with memory limit exceeding max
deployment_memory_exceeds := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {"template": {"spec": {"containers": [{
		"name": "app",
		"image": "nginx:1.21",
		"resources": {"limits": {
			"cpu": "500m",
			"memory": "10Gi",
		}},
	}]}}},
}

# Deployment with init container missing limits
deployment_init_no_limits := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {"template": {"spec": {
		"containers": [{
			"name": "app",
			"image": "nginx:1.21",
			"resources": {"limits": {
				"cpu": "500m",
				"memory": "256Mi",
			}},
		}],
		"initContainers": [{
			"name": "init-db",
			"image": "busybox:1.35",
		}],
	}}},
}

# Pod with ephemeral container missing limits
pod_ephemeral_no_limits := {
	"kind": "Pod",
	"metadata": {"name": "test-pod"},
	"spec": {
		"containers": [{
			"name": "app",
			"image": "nginx:1.21",
			"resources": {"limits": {
				"cpu": "500m",
				"memory": "256Mi",
			}},
		}],
		"ephemeralContainers": [{
			"name": "debugger",
			"image": "busybox:1.35",
		}],
	},
}

# Deployment with excluded container by name
deployment_excluded_container := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {"template": {"spec": {"containers": [
		{
			"name": "app",
			"image": "nginx:1.21",
			"resources": {"limits": {
				"cpu": "500m",
				"memory": "256Mi",
			}},
		},
		{
			"name": "sidecar",
			"image": "envoy:1.20",
		},
	]}}},
}

# Deployment with excluded image prefix
deployment_excluded_image := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {"template": {"spec": {"containers": [
		{
			"name": "app",
			"image": "nginx:1.21",
			"resources": {"limits": {
				"cpu": "500m",
				"memory": "256Mi",
			}},
		},
		{
			"name": "monitoring",
			"image": "gcr.io/istio-system/proxy:1.10",
		},
	]}}},
}

# Deployment with multiple violations
deployment_multiple_violations := {
	"kind": "Deployment",
	"metadata": {"name": "test-app"},
	"spec": {"template": {"spec": {"containers": [
		{
			"name": "app",
			"image": "nginx:1.21",
		},
		{
			"name": "sidecar",
			"image": "envoy:1.20",
			"resources": {"limits": {"cpu": "500m"}},
		},
		{
			"name": "cache",
			"image": "redis:6.2",
			"resources": {"limits": {
				"cpu": "10000m",
				"memory": "256Mi",
			}},
		},
	]}}},
}

# ==============================================================================
# Test Fixtures - Parameters
# ==============================================================================

default_params := {
	"cpuLimit": "8000m",
	"memoryLimit": "8Gi",
	"excludedContainers": [],
	"excludedImages": [],
}

params_with_excluded_container := {
	"cpuLimit": "8000m",
	"memoryLimit": "8Gi",
	"excludedContainers": ["sidecar"],
	"excludedImages": [],
}

params_with_excluded_image := {
	"cpuLimit": "8000m",
	"memoryLimit": "8Gi",
	"excludedContainers": [],
	"excludedImages": ["gcr.io/istio-system/*"],
}

# ==============================================================================
# Helper Functions for Tests
# ==============================================================================

# Build full input object with review and parameters
build_input(resource, params) := {"review": {"object": resource}, "parameters": params}

# ==============================================================================
# Tests - Missing Resource Limits
# ==============================================================================

test_violation_no_resource_limits if {
	test_input := build_input(deployment_no_limits, default_params)
	results := violations with input as test_input
	count(results) > 0

	# Verify violation mentions missing limits
	some violation in results
	contains(violation.msg, "app")
	contains(violation.msg, "no resource limits")
}

test_violation_missing_cpu_limit if {
	test_input := build_input(deployment_missing_cpu, default_params)
	results := violations with input as test_input
	count(results) > 0

	# Verify violation mentions missing CPU
	some violation in results
	contains(violation.msg, "app")
	contains(violation.msg, "CPU")
}

test_violation_missing_memory_limit if {
	test_input := build_input(deployment_missing_memory, default_params)
	results := violations with input as test_input
	count(results) > 0

	# Verify violation mentions missing memory
	some violation in results
	contains(violation.msg, "app")
	contains(violation.msg, "memory")
}

# ==============================================================================
# Tests - Exceeding Maximum Limits
# ==============================================================================

test_violation_cpu_exceeds_max if {
	test_input := build_input(deployment_cpu_exceeds, default_params)
	results := violations with input as test_input
	count(results) > 0

	# Verify violation mentions CPU limit exceeded
	some violation in results
	contains(violation.msg, "app")
	contains(violation.msg, "CPU")
	contains(violation.msg, "higher than")
}

test_violation_memory_exceeds_max if {
	test_input := build_input(deployment_memory_exceeds, default_params)
	results := violations with input as test_input
	count(results) > 0

	# Verify violation mentions memory limit exceeded
	some violation in results
	contains(violation.msg, "app")
	contains(violation.msg, "memory")
	contains(violation.msg, "higher than")
}

# ==============================================================================
# Tests - Valid Limits (No Violations)
# ==============================================================================

test_no_violation_valid_limits if {
	test_input := build_input(deployment_valid_limits, default_params)
	results := violations with input as test_input
	count(results) == 0
}

# ==============================================================================
# Tests - Init Containers
# ==============================================================================

test_violation_init_container_no_limits if {
	test_input := build_input(deployment_init_no_limits, default_params)
	results := violations with input as test_input
	count(results) > 0

	# Verify violation mentions init container
	some violation in results
	contains(violation.msg, "init-db")
}

# ==============================================================================
# Tests - Ephemeral Containers
# ==============================================================================

test_violation_ephemeral_container_no_limits if {
	test_input := build_input(pod_ephemeral_no_limits, default_params)
	results := violations with input as test_input
	count(results) > 0

	# Verify violation mentions ephemeral container
	some violation in results
	contains(violation.msg, "debugger")
}

# ==============================================================================
# Tests - Excluded Containers
# ==============================================================================

test_no_violation_excluded_container_by_name if {
	test_input := build_input(deployment_excluded_container, params_with_excluded_container)
	results := violations with input as test_input

	# Should only see violation for container with no limits that isn't excluded
	# In this fixture, "sidecar" is excluded, so no violations expected
	# (app has limits, sidecar is excluded)
	count(results) == 0
}

test_no_violation_excluded_container_by_image if {
	test_input := build_input(deployment_excluded_image, params_with_excluded_image)
	results := violations with input as test_input

	# Should only see violations for non-excluded containers
	# "monitoring" container with istio-system image should be excluded
	count(results) == 0
}

# ==============================================================================
# Tests - Multiple Violations
# ==============================================================================

test_multiple_violations_in_single_resource if {
	test_input := build_input(deployment_multiple_violations, default_params)
	results := violations with input as test_input

	# Expect multiple violations:
	# - app: no resource limits (2 violations: cpu + memory or single "no limits")
	# - sidecar: missing memory limit
	# - cache: cpu exceeds max
	count(results) >= 3
}

# ==============================================================================
# Tests - Default Parameters
# ==============================================================================

test_default_parameters_applied if {
	# Input without parameters should use defaults
	test_input_no_params := {"review": {"object": deployment_no_limits}}
	results := violations with input as test_input_no_params
	count(results) > 0

	# Should still detect violations with default limits
}

# ==============================================================================
# Tests - Edge Cases
# ==============================================================================

test_empty_containers_array if {
	empty_deployment := {
		"kind": "Deployment",
		"metadata": {"name": "test-app"},
		"spec": {"template": {"spec": {"containers": []}}},
	}
	test_input := build_input(empty_deployment, default_params)
	results := violations with input as test_input
	count(results) == 0
}

test_pod_without_template if {
	pod := {
		"kind": "Pod",
		"metadata": {"name": "test-pod"},
		"spec": {"containers": [{
			"name": "app",
			"image": "nginx:1.21",
		}]},
	}
	test_input := build_input(pod, default_params)
	results := violations with input as test_input
	count(results) > 0

	# Should detect missing limits in Pod spec
}

# ==============================================================================
# Tests - Different Resource Kinds
# ==============================================================================

test_deployment_kind if {
	test_input := build_input(deployment_no_limits, default_params)
	results := violations with input as test_input
	count(results) > 0
}

test_pod_kind if {
	pod := {
		"kind": "Pod",
		"metadata": {"name": "test-pod"},
		"spec": {"containers": [{
			"name": "app",
			"image": "nginx:1.21",
		}]},
	}
	test_input := build_input(pod, default_params)
	results := violations with input as test_input
	count(results) > 0
}

test_statefulset_kind if {
	statefulset := {
		"kind": "StatefulSet",
		"metadata": {"name": "test-db"},
		"spec": {"template": {"spec": {"containers": [{
			"name": "db",
			"image": "postgres:13",
		}]}}},
	}
	test_input := build_input(statefulset, default_params)
	results := violations with input as test_input
	count(results) > 0
}

test_daemonset_kind if {
	daemonset := {
		"kind": "DaemonSet",
		"metadata": {"name": "test-agent"},
		"spec": {"template": {"spec": {"containers": [{
			"name": "agent",
			"image": "fluentd:v1.14",
		}]}}},
	}
	test_input := build_input(daemonset, default_params)
	results := violations with input as test_input
	count(results) > 0
}

test_job_kind if {
	job := {
		"kind": "Job",
		"metadata": {"name": "test-job"},
		"spec": {"template": {"spec": {"containers": [{
			"name": "worker",
			"image": "alpine:3.14",
		}]}}},
	}
	test_input := build_input(job, default_params)
	results := violations with input as test_input
	count(results) > 0
}

test_cronjob_kind if {
	cronjob := {
		"kind": "CronJob",
		"metadata": {"name": "test-cron"},
		"spec": {"jobTemplate": {"spec": {"template": {"spec": {"containers": [{
			"name": "cron-worker",
			"image": "alpine:3.14",
		}]}}}}},
	}
	test_input := build_input(cronjob, default_params)
	results := violations with input as test_input
	count(results) > 0
}
