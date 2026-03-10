package safeguards.container_resource_limits

# ==============================================================================
# Container Resource Limits Rule
# ==============================================================================
#
# Validates that ALL containers (including init and ephemeral) have resource
# limits defined and that they don't exceed configurable maximum values.
#
# Based on: Azure Draft safeguards v1.0.0
# https://github.com/Azure/draft/blob/main/pkg/safeguards/lib/v1.0.0/container-resource-limits/
#
# Validations:
# - Containers must have resources.limits.cpu defined
# - Containers must have resources.limits.memory defined
# - CPU limits must not exceed configured maximum (default: 8000m)
# - Memory limits must not exceed configured maximum (default: 8Gi)
# - Applies to containers, initContainers, and ephemeralContainers
# - Supports exclusion by container name or image prefix
#
# ==============================================================================

import data.safeguards.lib as lib

# ==============================================================================
# Default Parameters
# ==============================================================================
#
# Default values match Azure Draft constraint.yaml
# https://github.com/Azure/draft/blob/main/pkg/safeguards/lib/v1.0.0/container-resource-limits/constraint.yaml
#
# Can be overridden via input.parameters

default_parameters := {
	"cpuLimit": "8000m",
	"memoryLimit": "8Gi",
	"excludedContainers": [],
	"excludedImages": [],
}

# Get parameters with defaults
parameters := object.union(default_parameters, object.get(input, "parameters", {}))

# ==============================================================================
# Main Violation Rules
# ==============================================================================

# Collect all violations - missing resources section
violations contains result if {
	pod_spec := lib.get_pod_spec(input.review.object)
	some container in lib.get_all_containers(pod_spec)

	# Skip excluded containers
	not is_excluded_by_name(container.name)
	not is_excluded_by_image(container.image)

	# Check for missing resources section
	not container.resources

	result := {
		"msg": sprintf("Container '%s' in %s '%s' has no resource limits", [
			container.name,
			input.review.object.kind,
			input.review.object.metadata.name,
		]),
		"details": {
			"resource": input.review.object.metadata.name,
			"resourceKind": input.review.object.kind,
			"container": container.name,
			"violationType": "missing-resources",
		},
	}
}

# Missing limits section
violations contains result if {
	pod_spec := lib.get_pod_spec(input.review.object)
	some container in lib.get_all_containers(pod_spec)

	# Skip excluded containers
	not is_excluded_by_name(container.name)
	not is_excluded_by_image(container.image)

	# Has resources but no limits section
	container.resources
	not container.resources.limits

	result := {
		"msg": sprintf("Container '%s' in %s '%s' has no resource limits", [
			container.name,
			input.review.object.kind,
			input.review.object.metadata.name,
		]),
		"details": {
			"resource": input.review.object.metadata.name,
			"resourceKind": input.review.object.kind,
			"container": container.name,
			"violationType": "missing-limits",
		},
	}
}

# Missing CPU limit
violations contains result if {
	pod_spec := lib.get_pod_spec(input.review.object)
	some container in lib.get_all_containers(pod_spec)

	# Skip excluded containers
	not is_excluded_by_name(container.name)
	not is_excluded_by_image(container.image)

	# Has limits but missing CPU
	container.resources.limits
	not container.resources.limits.cpu

	result := {
		"msg": sprintf("Container '%s' in %s '%s' has no CPU limit", [
			container.name,
			input.review.object.kind,
			input.review.object.metadata.name,
		]),
		"details": {
			"resource": input.review.object.metadata.name,
			"resourceKind": input.review.object.kind,
			"container": container.name,
			"violationType": "missing-cpu-limit",
		},
	}
}

# Empty CPU limit string
violations contains result if {
	pod_spec := lib.get_pod_spec(input.review.object)
	some container in lib.get_all_containers(pod_spec)

	# Skip excluded containers
	not is_excluded_by_name(container.name)
	not is_excluded_by_image(container.image)

	# Has limits with CPU but it's empty string
	container.resources.limits
	container.resources.limits.cpu == ""

	result := {
		"msg": sprintf("Container '%s' in %s '%s' has no CPU limit", [
			container.name,
			input.review.object.kind,
			input.review.object.metadata.name,
		]),
		"details": {
			"resource": input.review.object.metadata.name,
			"resourceKind": input.review.object.kind,
			"container": container.name,
			"violationType": "missing-cpu-limit",
		},
	}
}

# Missing memory limit
violations contains result if {
	pod_spec := lib.get_pod_spec(input.review.object)
	some container in lib.get_all_containers(pod_spec)

	# Skip excluded containers
	not is_excluded_by_name(container.name)
	not is_excluded_by_image(container.image)

	# Has limits but missing memory
	container.resources.limits
	not container.resources.limits.memory

	result := {
		"msg": sprintf("Container '%s' in %s '%s' has no memory limit", [
			container.name,
			input.review.object.kind,
			input.review.object.metadata.name,
		]),
		"details": {
			"resource": input.review.object.metadata.name,
			"resourceKind": input.review.object.kind,
			"container": container.name,
			"violationType": "missing-memory-limit",
		},
	}
}

# Empty memory limit string
violations contains result if {
	pod_spec := lib.get_pod_spec(input.review.object)
	some container in lib.get_all_containers(pod_spec)

	# Skip excluded containers
	not is_excluded_by_name(container.name)
	not is_excluded_by_image(container.image)

	# Has limits with memory but it's empty string
	container.resources.limits
	container.resources.limits.memory == ""

	result := {
		"msg": sprintf("Container '%s' in %s '%s' has no memory limit", [
			container.name,
			input.review.object.kind,
			input.review.object.metadata.name,
		]),
		"details": {
			"resource": input.review.object.metadata.name,
			"resourceKind": input.review.object.kind,
			"container": container.name,
			"violationType": "missing-memory-limit",
		},
	}
}

# CPU limit exceeds maximum
violations contains result if {
	pod_spec := lib.get_pod_spec(input.review.object)
	some container in lib.get_all_containers(pod_spec)

	# Skip excluded containers
	not is_excluded_by_name(container.name)
	not is_excluded_by_image(container.image)

	# Has CPU limit but it exceeds max
	cpu_orig := container.resources.limits.cpu
	cpu_orig != ""
	cpu := lib.canonify_cpu(cpu_orig)

	max_cpu_orig := parameters.cpuLimit
	max_cpu := lib.canonify_cpu(max_cpu_orig)

	cpu > max_cpu

	result := {
		"msg": sprintf("Container '%s' in %s '%s' CPU limit '%v' is higher than the maximum allowed of '%v'", [
			container.name,
			input.review.object.kind,
			input.review.object.metadata.name,
			cpu_orig,
			max_cpu_orig,
		]),
		"details": {
			"resource": input.review.object.metadata.name,
			"resourceKind": input.review.object.kind,
			"container": container.name,
			"violationType": "cpu-exceeds-max",
			"currentValue": cpu_orig,
			"maxValue": max_cpu_orig,
		},
	}
}

# Memory limit exceeds maximum
violations contains result if {
	pod_spec := lib.get_pod_spec(input.review.object)
	some container in lib.get_all_containers(pod_spec)

	# Skip excluded containers
	not is_excluded_by_name(container.name)
	not is_excluded_by_image(container.image)

	# Has memory limit but it exceeds max
	mem_orig := container.resources.limits.memory
	mem_orig != ""
	mem := lib.canonify_mem(mem_orig)

	max_mem_orig := parameters.memoryLimit
	max_mem := lib.canonify_mem(max_mem_orig)

	mem > max_mem

	result := {
		"msg": sprintf("Container '%s' in %s '%s' memory limit '%v' is higher than the maximum allowed of '%v'", [
			container.name,
			input.review.object.kind,
			input.review.object.metadata.name,
			mem_orig,
			max_mem_orig,
		]),
		"details": {
			"resource": input.review.object.metadata.name,
			"resourceKind": input.review.object.kind,
			"container": container.name,
			"violationType": "memory-exceeds-max",
			"currentValue": mem_orig,
			"maxValue": max_mem_orig,
		},
	}
}

# ==============================================================================
# Exclusion Helper Functions
# ==============================================================================

# Check if container is excluded by name
is_excluded_by_name(container_name) if {
	some excluded in parameters.excludedContainers
	container_name == excluded
}

# Check if container is excluded by image prefix (with wildcard)
is_excluded_by_image(image) if {
	some excluded_image in parameters.excludedImages

	# Support prefix matching with wildcard
	endswith(excluded_image, "*")
	prefix := trim_suffix(excluded_image, "*")
	startswith(image, prefix)
}

# Exact match for excluded images (no wildcard)
is_excluded_by_image(image) if {
	some excluded_image in parameters.excludedImages

	# Exact match (no wildcard)
	not endswith(excluded_image, "*")
	image == excluded_image
}
