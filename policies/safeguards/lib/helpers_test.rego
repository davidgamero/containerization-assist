package safeguards.lib

# ==============================================================================
# Helpers Test Suite
# ==============================================================================
#
# Comprehensive tests for Kubernetes unit canonification and container/pod helpers.
# Run with: opa test policies/safeguards/lib/ -v
#
# ==============================================================================

# ==============================================================================
# CPU Canonification Tests
# ==============================================================================

test_canonify_cpu_millicore_format if {
	# "500m" should canonify to 500
	result := canonify_cpu("500m")
	result == 500
}

test_canonify_cpu_whole_number if {
	# "1" (whole CPU) should canonify to 1000 millicores
	result := canonify_cpu("1")
	result == 1000
}

test_canonify_cpu_fractional if {
	# "0.5" (half CPU) should canonify to 500 millicores
	result := canonify_cpu("0.5")
	result == 500
}

test_canonify_cpu_fractional_millicore if {
	# "100m" should canonify to 100 millicores
	result := canonify_cpu("100m")
	result == 100
}

test_canonify_cpu_numeric_input if {
	# Numeric input 2 should canonify to 2000 millicores
	result := canonify_cpu(2)
	result == 2000
}

test_canonify_cpu_numeric_fractional_input if {
	# Numeric fractional input 0.25 should canonify to 250 millicores
	result := canonify_cpu(0.25)
	result == 250
}

test_canonify_cpu_large_value if {
	# "10" should canonify to 10000 millicores
	result := canonify_cpu("10")
	result == 10000
}

# ==============================================================================
# Memory Canonification Tests - SI (Decimal) Format
# ==============================================================================

test_canonify_mem_si_k if {
	# "1k" should canonify to 1,000,000 bytes (lowercase k per Kubernetes spec)
	result := canonify_mem("1k")
	result == 1000000
}

test_canonify_mem_si_m if {
	# "128M" should canonify to 128,000,000,000 bytes
	result := canonify_mem("128M")
	result == 128000000000
}

test_canonify_mem_si_g if {
	# "1G" should canonify to 1,000,000,000,000 bytes
	result := canonify_mem("1G")
	result == 1000000000000
}

test_canonify_mem_si_t if {
	# "1T" should canonify to 1,000,000,000,000,000 bytes
	result := canonify_mem("1T")
	result == 1000000000000000
}

# ==============================================================================
# Memory Canonification Tests - IEC (Binary) Format
# ==============================================================================

test_canonify_mem_iec_ki if {
	# "1Ki" should canonify to 1,024,000 bytes
	result := canonify_mem("1Ki")
	result == 1024000
}

test_canonify_mem_iec_mi if {
	# "128Mi" should canonify to 134,217,728,000 bytes
	result := canonify_mem("128Mi")
	result == 134217728000
}

test_canonify_mem_iec_gi if {
	# "1Gi" should canonify to 1,073,741,824,000 bytes
	result := canonify_mem("1Gi")
	result == 1073741824000
}

test_canonify_mem_iec_ti if {
	# "1Ti" should canonify to 1,099,511,627,776,000 bytes
	result := canonify_mem("1Ti")
	result == 1099511627776000
}

# ==============================================================================
# Memory Canonification Tests - Edge Cases
# ==============================================================================

test_canonify_mem_no_suffix if {
	# "1000" (no suffix) should canonify to 1,000,000 bytes (default multiplier 1000)
	result := canonify_mem("1000")
	result == 1000000
}

test_canonify_mem_millibye_edge_case if {
	# "1000m" should canonify to 1,000 bytes (millibytes edge case)
	# https://github.com/kubernetes/kubernetes/issues/28741
	result := canonify_mem("1000m")
	result == 1000
}

test_canonify_mem_numeric_input if {
	# Numeric input 1 should canonify to 1000 bytes (default multiplier)
	result := canonify_mem(1)
	result == 1000
}

test_canonify_mem_fractional if {
	# "0.5Gi" should canonify to fractional Gi value
	result := canonify_mem("0.5Gi")
	result == 536870912000
}

test_canonify_mem_decimal_mi if {
	# "256.5Mi" should canonify correctly with decimal
	result := canonify_mem("256.5Mi")
	result == 268959744000
}

# ==============================================================================
# Memory Suffix Extraction Tests
# ==============================================================================

test_get_suffix_single_char if {
	# "1G" -> "G"
	result := get_suffix("1G")
	result == "G"
}

test_get_suffix_two_char if {
	# "128Mi" -> "Mi"
	result := get_suffix("128Mi")
	result == "Mi"
}

test_get_suffix_none if {
	# "1000" -> "" (no suffix)
	result := get_suffix("1000")
	result == ""
}

test_get_suffix_millibye if {
	# "1000m" -> "m"
	result := get_suffix("1000m")
	result == "m"
}

test_get_suffix_numeric_input if {
	# Numeric input 100 -> "" (no suffix)
	result := get_suffix(100)
	result == ""
}

test_get_suffix_empty_string if {
	# "" -> ""
	result := get_suffix("")
	result == ""
}

# ==============================================================================
# Container/Pod Helper Tests
# ==============================================================================

test_get_all_containers_all_types if {
	# Pod spec with containers, initContainers, and ephemeralContainers
	pod_spec := {
		"containers": [{"name": "app"}],
		"initContainers": [{"name": "init"}],
		"ephemeralContainers": [{"name": "debug"}],
	}
	result := get_all_containers(pod_spec)
	count(result) == 3
	result[0].name == "app"
	result[1].name == "init"
	result[2].name == "debug"
}

test_get_all_containers_only_containers if {
	# Pod spec with only containers
	pod_spec := {"containers": [{"name": "app"}]}
	result := get_all_containers(pod_spec)
	count(result) == 1
	result[0].name == "app"
}

test_get_all_containers_missing_fields if {
	# Pod spec with missing optional fields
	pod_spec := {"containers": [{"name": "app"}]}
	result := get_all_containers(pod_spec)
	count(result) == 1
}

test_get_all_containers_empty if {
	# Empty pod spec
	pod_spec := {}
	result := get_all_containers(pod_spec)
	count(result) == 0
}

test_get_regular_containers_no_init if {
	# Pod spec with containers and ephemeral, no initContainers
	pod_spec := {
		"containers": [{"name": "app"}],
		"ephemeralContainers": [{"name": "debug"}],
	}
	result := get_regular_containers(pod_spec)
	count(result) == 2
	result[0].name == "app"
	result[1].name == "debug"
}

test_get_regular_containers_excludes_init if {
	# Pod spec with all types, initContainers should be excluded
	pod_spec := {
		"containers": [{"name": "app"}],
		"initContainers": [{"name": "init"}],
		"ephemeralContainers": [{"name": "debug"}],
	}
	result := get_regular_containers(pod_spec)
	count(result) == 2
	result[0].name == "app"
	result[1].name == "debug"
}

# ==============================================================================
# Pod Spec Extraction Tests
# ==============================================================================

test_get_pod_spec_from_pod if {
	# Direct Pod object
	obj := {
		"kind": "Pod",
		"spec": {
			"containers": [{"name": "app"}],
		},
	}
	result := get_pod_spec(obj)
	count(result.containers) == 1
}

test_get_pod_spec_from_deployment if {
	# Deployment object
	obj := {
		"kind": "Deployment",
		"spec": {
			"template": {
				"spec": {
					"containers": [{"name": "app"}],
				},
			},
		},
	}
	result := get_pod_spec(obj)
	count(result.containers) == 1
}

test_get_pod_spec_from_statefulset if {
	# StatefulSet object
	obj := {
		"kind": "StatefulSet",
		"spec": {
			"template": {
				"spec": {
					"containers": [{"name": "app"}],
				},
			},
		},
	}
	result := get_pod_spec(obj)
	count(result.containers) == 1
}

test_get_pod_spec_from_daemonset if {
	# DaemonSet object
	obj := {
		"kind": "DaemonSet",
		"spec": {
			"template": {
				"spec": {
					"containers": [{"name": "app"}],
				},
			},
		},
	}
	result := get_pod_spec(obj)
	count(result.containers) == 1
}

test_get_pod_spec_from_job if {
	# Job object
	obj := {
		"kind": "Job",
		"spec": {
			"template": {
				"spec": {
					"containers": [{"name": "app"}],
				},
			},
		},
	}
	result := get_pod_spec(obj)
	count(result.containers) == 1
}

test_get_pod_spec_from_cronjob if {
	# CronJob object
	obj := {
		"kind": "CronJob",
		"spec": {
			"jobTemplate": {
				"spec": {
					"template": {
						"spec": {
							"containers": [{"name": "app"}],
						},
					},
				},
			},
		},
	}
	result := get_pod_spec(obj)
	count(result.containers) == 1
}

test_get_pod_spec_unknown_kind if {
	# Unknown resource type
	obj := {
		"kind": "UnknownType",
		"spec": {"containers": [{"name": "app"}]},
	}
	result := get_pod_spec(obj)
	result == {}
}

test_get_pod_spec_missing_spec if {
	# Pod with missing spec
	obj := {"kind": "Pod"}
	result := get_pod_spec(obj)
	result == {}
}

# ==============================================================================
# Memory Conversion Accuracy Tests (Regression)
# ==============================================================================

test_canonify_mem_128mi_exact if {
	# Exact value: 128Mi = 128 * 1,048,576,000 = 134,217,728,000
	result := canonify_mem("128Mi")
	result == 134217728000
}

test_canonify_mem_1gi_exact if {
	# Exact value: 1Gi = 1 * 1,073,741,824,000 = 1,073,741,824,000
	result := canonify_mem("1Gi")
	result == 1073741824000
}

test_canonify_mem_1000m_exact if {
	# Exact value: 1000m = 1000 * 1 = 1,000 (millibytes)
	result := canonify_mem("1000m")
	result == 1000
}

test_canonify_mem_1000m_exact_decimal if {
	# Exact value: 1000.5m = 1000.5 * 1 = 1,000.5 (millibytes with decimal)
	result := canonify_mem("1000.5m")
	result == 1000.5
}

# ==============================================================================
# Empty and Boundary Cases
# ==============================================================================

test_canonify_cpu_zero_millicore if {
	# "0m" should canonify to 0
	result := canonify_cpu("0m")
	result == 0
}

test_canonify_mem_zero_suffix if {
	# "0M" should canonify to 0
	result := canonify_mem("0M")
	result == 0
}

test_get_all_containers_multiple_same_type if {
	# Pod spec with multiple containers
	pod_spec := {
		"containers": [
			{"name": "app1"},
			{"name": "app2"},
		],
	}
	result := get_all_containers(pod_spec)
	count(result) == 2
}
