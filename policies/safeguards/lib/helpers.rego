package safeguards.lib

# ==============================================================================
# Kubernetes Unit Canonification and Helper Functions
# ==============================================================================
#
# Shared helpers for validating and canonifying Kubernetes resource units
# (CPU and memory) across different rule packages. These functions handle
# all Kubernetes unit formats including:
# - CPU: millicores (m), whole numbers, fractional values
# - Memory: SI (K, M, G, T, P, E), decimal (Ki, Mi, Gi, Ti, Pi, Ei), and millibytes
#
# Port source: https://github.com/Azure/draft
#
# ==============================================================================

# Canonify CPU limits to millicores (m)
# Handles: "500m" -> 500, "1" -> 1000, "0.5" -> 500
#
# Rule 1: Input is already a number, convert to millicores
canonify_cpu(orig) = new if {
	is_number(orig)
	new := orig * 1000
}

# Rule 2: Input ends with "m" (millicores), strip suffix and convert
canonify_cpu(orig) = new if {
	not is_number(orig)
	endswith(orig, "m")
	new := to_number(replace(orig, "m", ""))
}

# Rule 3: Input is numeric string (whole or fractional), multiply by 1000
canonify_cpu(orig) = new if {
	not is_number(orig)
	not endswith(orig, "m")
	regex.match("^[0-9]+(\\.[0-9]+)?$", orig)
	new := to_number(orig) * 1000
}

# Memory unit multipliers (SI and IEC formats)
# Reference: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/

# 10 ** 21
mem_multiple("E") = 1000000000000000000000 if true

# 10 ** 18
mem_multiple("P") = 1000000000000000000 if true

# 10 ** 15
mem_multiple("T") = 1000000000000000 if true

# 10 ** 12
mem_multiple("G") = 1000000000000 if true

# 10 ** 9
mem_multiple("M") = 1000000000 if true

# 10 ** 6
mem_multiple("k") = 1000000 if true

# 10 ** 3 (default: no suffix means thousands)
mem_multiple("") = 1000 if true

# 10 ** 0 (millibytes - Kubernetes edge case)
# https://github.com/kubernetes/kubernetes/issues/28741
mem_multiple("m") = 1 if true

# IEC binary prefixes with SI compensation (1000 * 2**n)
# 1000 * 2 ** 10 = 1,024,000
mem_multiple("Ki") = 1024000 if true

# 1000 * 2 ** 20 = 1,048,576,000
mem_multiple("Mi") = 1048576000 if true

# 1000 * 2 ** 30 = 1,073,741,824,000
mem_multiple("Gi") = 1073741824000 if true

# 1000 * 2 ** 40
mem_multiple("Ti") = 1099511627776000 if true

# 1000 * 2 ** 50
mem_multiple("Pi") = 1125899906842624000 if true

# 1000 * 2 ** 60
mem_multiple("Ei") = 1152921504606846976000 if true

# Extract suffix from memory string
# Handles: "128Mi" -> "Mi", "1G" -> "G", "1000" -> ""
#
# Rule 1: Non-string input (number), return empty suffix
get_suffix(mem) = suffix if {
	not is_string(mem)
	suffix := ""
}

# Rule 2: Check last character (1-char suffix like "G", "M", "k", "m")
get_suffix(mem) = suffix if {
	is_string(mem)
	count(mem) > 0
	suffix := substring(mem, count(mem) - 1, -1)
	mem_multiple(suffix)
}

# Rule 3: Check last 2 characters (2-char suffix like "Ki", "Mi", "Gi")
get_suffix(mem) = suffix if {
	is_string(mem)
	count(mem) > 1
	suffix := substring(mem, count(mem) - 2, -1)
	mem_multiple(suffix)
}

# Rule 4: Neither last nor last 2 chars match a known suffix, no suffix
get_suffix(mem) = suffix if {
	is_string(mem)
	count(mem) > 1
	not mem_multiple(substring(mem, count(mem) - 1, -1))
	not mem_multiple(substring(mem, count(mem) - 2, -1))
	suffix := ""
}

# Rule 5: Single character string, not a known suffix, no suffix
get_suffix(mem) = suffix if {
	is_string(mem)
	count(mem) == 1
	not mem_multiple(substring(mem, count(mem) - 1, -1))
	suffix := ""
}

# Rule 6: Empty string, no suffix
get_suffix(mem) = suffix if {
	is_string(mem)
	count(mem) == 0
	suffix := ""
}

# Canonify memory limits to absolute bytes
# Handles all K8s memory formats:
# - "128Mi" -> 134217728000 (128 * 1048576000)
# - "1Gi" -> 1073741824000 (1 * 1073741824000)
# - "1000M" -> 1000000000000 (1000 * 1000000000)
# - "1000m" -> 1000 (1000 * 1)
#
# Rule 1: Input is already a number, convert using default multiplier (1000)
canonify_mem(orig) = new if {
	is_number(orig)
	new := orig * 1000
}

# Rule 2: Input is string with valid numeric prefix, parse and multiply
canonify_mem(orig) = new if {
	not is_number(orig)
	suffix := get_suffix(orig)
	raw := replace(orig, suffix, "")
	regex.match("^[0-9]+(\\.[0-9]+)?$", raw)
	new := to_number(raw) * mem_multiple(suffix)
}

# ==============================================================================
# Container and Pod Spec Helpers
# ==============================================================================

# Extract all containers from a pod spec
# Includes: containers, initContainers, and ephemeralContainers
# Use for rules that apply to ALL container types
get_all_containers(pod_spec) = containers if {
	containers := array.concat(
		array.concat(
			object.get(pod_spec, "containers", []),
			object.get(pod_spec, "initContainers", [])
		),
		object.get(pod_spec, "ephemeralContainers", [])
	)
}

# Extract regular containers from pod spec (excludes initContainers)
# Includes: containers and ephemeralContainers
# Use for rules that shouldn't apply to init containers (e.g., probes)
get_regular_containers(pod_spec) = containers if {
	containers := array.concat(
		object.get(pod_spec, "containers", []),
		object.get(pod_spec, "ephemeralContainers", [])
	)
}

# Extract pod spec from various Kubernetes resource types
# Supports: Deployment, StatefulSet, DaemonSet, Pod, Job, CronJob
# Returns empty object if resource type not recognized
get_pod_spec(obj) = pod_spec if {
	kind := object.get(obj, "kind", "")
	
	# Direct pod object
	kind == "Pod"
	pod_spec := object.get(obj, "spec", {})
}

get_pod_spec(obj) = pod_spec if {
	kind := object.get(obj, "kind", "")
	
	# Workload types with spec.template.spec
	kind in ["Deployment", "StatefulSet", "DaemonSet"]
	pod_spec := object.get(object.get(object.get(obj, "spec", {}), "template", {}), "spec", {})
}

get_pod_spec(obj) = pod_spec if {
	kind := object.get(obj, "kind", "")
	
	# Job types
	kind == "Job"
	pod_spec := object.get(object.get(object.get(obj, "spec", {}), "template", {}), "spec", {})
}

get_pod_spec(obj) = pod_spec if {
	kind := object.get(obj, "kind", "")
	
	# CronJob type - break up nested calls to avoid line length issues
	kind == "CronJob"
	spec := object.get(obj, "spec", {})
	job_template := object.get(spec, "jobTemplate", {})
	template_spec := object.get(job_template, "spec", {})
	template := object.get(template_spec, "template", {})
	pod_spec := object.get(template, "spec", {})
}

# Fallback: unknown resource type
get_pod_spec(obj) = {} if {
	true
}
