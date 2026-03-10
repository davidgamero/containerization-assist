package safeguards.disallowed_bad_pdb

# ==============================================================================
# disallowed-bad-pod-disruption-budgets Safeguard Rule
# ==============================================================================
#
# Checks if PodDisruptionBudget resources allow evictions.
# A "bad" PDB blocks all evictions when:
# - maxUnavailable is 0 (no pods can be unavailable during disruption)
# - minAvailable is 100% (all pods must be available, none can be disrupted)
#
# Reference: https://github.com/Azure/draft/blob/main/pkg/safeguards/lib/v1.0.0/disallowed-bad-pod-disruption-budgets/template.yaml
#

# ============================================================================
# Violation 1: maxUnavailable == 0 (numeric)
# ============================================================================
violations contains result if {
	pdb := input.review.object
	pdb.kind == "PodDisruptionBudget"
	
	spec := object.get(pdb, "spec", {})
	max_unavailable := object.get(spec, "maxUnavailable", null)
	max_unavailable == 0
	
	name := object.get(object.get(pdb, "metadata", {}), "name", "Unknown")
	
	result := {
		"msg": sprintf("PodDisruptionBudget '%s' has maxUnavailable of 0, only positive integers are allowed", [name]),
		"details": {
			"resource": name,
			"resourceKind": "PodDisruptionBudget",
			"violationType": "bad-max-unavailable"
		}
	}
}

# ============================================================================
# Violation 2: maxUnavailable == "0%" (percentage string)
# ============================================================================
violations contains result if {
	pdb := input.review.object
	pdb.kind == "PodDisruptionBudget"
	
	spec := object.get(pdb, "spec", {})
	max_unavailable := object.get(spec, "maxUnavailable", null)
	max_unavailable == "0%"
	
	name := object.get(object.get(pdb, "metadata", {}), "name", "Unknown")
	
	result := {
		"msg": sprintf("PodDisruptionBudget '%s' has maxUnavailable of 0%%, only positive integers or percentages are allowed", [name]),
		"details": {
			"resource": name,
			"resourceKind": "PodDisruptionBudget",
			"violationType": "bad-max-unavailable"
		}
	}
}

# ============================================================================
# Violation 3: minAvailable == "100%" (percentage string)
# ============================================================================
violations contains result if {
	pdb := input.review.object
	pdb.kind == "PodDisruptionBudget"
	
	spec := object.get(pdb, "spec", {})
	min_available := object.get(spec, "minAvailable", null)
	min_available == "100%"
	
	name := object.get(object.get(pdb, "metadata", {}), "name", "Unknown")
	
	result := {
		"msg": sprintf("PodDisruptionBudget '%s' has minAvailable of 100%%, which blocks all evictions", [name]),
		"details": {
			"resource": name,
			"resourceKind": "PodDisruptionBudget",
			"violationType": "bad-min-available"
		}
	}
}
