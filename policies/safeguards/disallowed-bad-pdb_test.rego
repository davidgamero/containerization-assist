package safeguards.disallowed_bad_pdb_test

import data.safeguards.disallowed_bad_pdb

# ==============================================================================
# Test Suite: disallowed-bad-pod-disruption-budgets
# ==============================================================================
# Tests validation that PodDisruptionBudget resources don't block evictions
# Bad PDBs have: maxUnavailable == 0, maxUnavailable == "0%", minAvailable == "100%"
# ==============================================================================

# Test: PDB with maxUnavailable 0 should generate violation
test_pdb_max_unavailable_zero if {
	test_input := {
		"review": {
			"object": {
				"kind": "PodDisruptionBudget",
				"metadata": {"name": "test-pdb", "namespace": "default"},
				"spec": {
					"maxUnavailable": 0,
					"selector": {"matchLabels": {"app": "test"}}
				}
			}
		},
		"parameters": {}
	}
	result := disallowed_bad_pdb.violations with input as test_input
	count(result) == 1
	some violation in result
	violation.details.violationType == "bad-max-unavailable"
}

# Test: PDB with maxUnavailable "0%" should generate violation
test_pdb_max_unavailable_zero_percent if {
	test_input := {
		"review": {
			"object": {
				"kind": "PodDisruptionBudget",
				"metadata": {"name": "test-pdb-percent", "namespace": "default"},
				"spec": {
					"maxUnavailable": "0%",
					"selector": {"matchLabels": {"app": "test"}}
				}
			}
		},
		"parameters": {}
	}
	result := disallowed_bad_pdb.violations with input as test_input
	count(result) == 1
}

# Test: PDB with minAvailable "100%" should generate violation
test_pdb_min_available_100_percent if {
	test_input := {
		"review": {
			"object": {
				"kind": "PodDisruptionBudget",
				"metadata": {"name": "test-pdb-100", "namespace": "default"},
				"spec": {
					"minAvailable": "100%",
					"selector": {"matchLabels": {"app": "test"}}
				}
			}
		},
		"parameters": {}
	}
	result := disallowed_bad_pdb.violations with input as test_input
	count(result) == 1
	some violation in result
	violation.details.violationType == "bad-min-available"
}

# Test: PDB with maxUnavailable 1 should not generate violation
test_pdb_max_unavailable_positive if {
	test_input := {
		"review": {
			"object": {
				"kind": "PodDisruptionBudget",
				"metadata": {"name": "test-pdb-good", "namespace": "default"},
				"spec": {
					"maxUnavailable": 1,
					"selector": {"matchLabels": {"app": "test"}}
				}
			}
		},
		"parameters": {}
	}
	result := disallowed_bad_pdb.violations with input as test_input
	count(result) == 0
}

# Test: PDB with maxUnavailable "25%" should not generate violation
test_pdb_max_unavailable_percent_positive if {
	test_input := {
		"review": {
			"object": {
				"kind": "PodDisruptionBudget",
				"metadata": {"name": "test-pdb-25pct", "namespace": "default"},
				"spec": {
					"maxUnavailable": "25%",
					"selector": {"matchLabels": {"app": "test"}}
				}
			}
		},
		"parameters": {}
	}
	result := disallowed_bad_pdb.violations with input as test_input
	count(result) == 0
}

# Test: PDB with minAvailable "50%" should not generate violation
test_pdb_min_available_percent_positive if {
	test_input := {
		"review": {
			"object": {
				"kind": "PodDisruptionBudget",
				"metadata": {"name": "test-pdb-50pct", "namespace": "default"},
				"spec": {
					"minAvailable": "50%",
					"selector": {"matchLabels": {"app": "test"}}
				}
			}
		},
		"parameters": {}
	}
	result := disallowed_bad_pdb.violations with input as test_input
	count(result) == 0
}

# Test: PDB with minAvailable positive integer should not generate violation
test_pdb_min_available_positive_int if {
	test_input := {
		"review": {
			"object": {
				"kind": "PodDisruptionBudget",
				"metadata": {"name": "test-pdb-int", "namespace": "default"},
				"spec": {
					"minAvailable": 2,
					"selector": {"matchLabels": {"app": "test"}}
				}
			}
		},
		"parameters": {}
	}
	result := disallowed_bad_pdb.violations with input as test_input
	count(result) == 0
}

# Test: Non-PDB resource should not match
test_non_pdb_resource if {
	test_input := {
		"review": {
			"object": {
				"kind": "Pod",
				"metadata": {"name": "test-pod", "namespace": "default"},
				"spec": {
					"containers": [{"name": "app", "image": "nginx:latest"}]
				}
			}
		},
		"parameters": {}
	}
	result := disallowed_bad_pdb.violations with input as test_input
	count(result) == 0
}

# Test: PDB without any disruption budget spec should not generate violation
test_pdb_no_spec if {
	test_input := {
		"review": {
			"object": {
				"kind": "PodDisruptionBudget",
				"metadata": {"name": "test-pdb-empty", "namespace": "default"},
				"spec": {
					"selector": {"matchLabels": {"app": "test"}}
				}
			}
		},
		"parameters": {}
	}
	result := disallowed_bad_pdb.violations with input as test_input
	count(result) == 0
}

# Test: Multiple violations in same PDB (maxUnavailable 0 AND minAvailable 100%)
test_pdb_multiple_violations if {
	test_input := {
		"review": {
			"object": {
				"kind": "PodDisruptionBudget",
				"metadata": {"name": "test-pdb-multi", "namespace": "default"},
				"spec": {
					"maxUnavailable": 0,
					"minAvailable": "100%",
					"selector": {"matchLabels": {"app": "test"}}
				}
			}
		},
		"parameters": {}
	}
	result := disallowed_bad_pdb.violations with input as test_input
	count(result) == 2
}
