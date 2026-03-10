package safeguards.pod_enforce_antiaffinity

import data.safeguards.lib as lib

# ==============================================================================
# pod-enforce-antiaffinity Safeguard Rule
# ==============================================================================
#
# Validates that multi-replica workloads (replicas > 1) have either
# podAntiAffinity or topologySpreadConstraints configured for pod distribution.
# This implements the Azure Draft safeguard:
# https://github.com/Azure/draft/blob/main/pkg/safeguards/lib/v1.0.0/pod-enforce-antiaffinity/template.yaml
#
# Behavior:
# - Only applies when spec.replicas > 1
# - Accepts EITHER podAntiAffinity OR topologySpreadConstraints
# - Existence check only — does NOT validate rule content
# - Returns violation if multi-replica and neither configured
#
# ==============================================================================

# Get the pod spec from the input object
pod_spec := lib.get_pod_spec(input.review.object)

# Get the replicas count, default to 1 if not specified
replicas := object.get(input.review.object.spec, "replicas", 1)

# Check if pod has podAntiAffinity configured (existence check only)
has_antiaffinity(spec) if {
	spec.affinity.podAntiAffinity
}

# Check if pod has topologySpreadConstraints configured
has_topology_spread(spec) if {
	count(spec.topologySpreadConstraints) > 0
}

# Generate violations for multi-replica workloads without anti-affinity
violations contains result if {
	# Only check multi-replica workloads
	replicas > 1
	
	# Check if neither podAntiAffinity nor topologySpreadConstraints configured
	not has_antiaffinity(pod_spec)
	not has_topology_spread(pod_spec)
	
	# Generate violation result
	result := {
		"rule": "pod-enforce-antiaffinity",
		"message": sprintf(
			"Workload with %d replicas must have either podAntiAffinity or topologySpreadConstraints configured for pod distribution",
			[replicas]
		),
		"replicas": replicas
	}
}
