package safeguards.container_enforce_probes

import data.safeguards.lib as lib

# ==============================================================================
# Rule: container-enforce-probes
# ==============================================================================
# Validates that regular containers (excluding init and ephemeral) have
# readinessProbe and livenessProbe configured.
#
# Probe types accepted: httpGet, tcpSocket, exec, grpc
#
# References:
# - Azure Draft: https://github.com/Azure/draft/blob/main/pkg/safeguards/lib/v1.0.0/container-enforce-probes/template.yaml
# - Kubernetes Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
# ==============================================================================

# Extract default parameters
parameters := object.get(input, "parameters", {
	"enforceProbes": ["readinessProbe", "livenessProbe"],
})

# Extract resource metadata
resource := input.review.object
kind := object.get(resource, "kind", "")
name := object.get(resource.metadata, "name", "")

# Extract pod spec using helper
pod_spec := lib.get_pod_spec(resource)

# Define valid probe types
probe_types := {"httpGet", "tcpSocket", "exec", "grpc"}

# ==============================================================================
# Violation Detection
# ==============================================================================

# Check if a probe is missing or empty
probe_is_missing(container, probe_name) if {
	# Probe field doesn't exist
	not container[probe_name]
}

probe_is_missing(container, probe_name) if {
	# Probe field exists but is empty (no probe type defined)
	probe := container[probe_name]
	probe_fields := {field | probe[field]}
	intersection := probe_fields & probe_types
	count(intersection) == 0
}

# Generate violations for missing probes
violations contains result if {
	# Iterate over regular containers (excludes init containers)
	containers := lib.get_regular_containers(pod_spec)
	container := containers[_]
	
	# Check each enforced probe type
	probe_name := parameters.enforceProbes[_]
	probe_is_missing(container, probe_name)
	
	# Determine violation type
	violation_type := sprintf("missing-%s", [lower(replace(probe_name, "Probe", "-probe"))])
	
	# Build violation message
	result := {
		"msg": sprintf("Container '%s' in %s '%s' missing %s", [container.name, kind, name, probe_name]),
		"details": {
			"resource": name,
			"resourceKind": kind,
			"container": container.name,
			"violationType": violation_type,
		},
	}
}
