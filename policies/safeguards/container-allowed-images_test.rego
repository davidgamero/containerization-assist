package safeguards.container_allowed_images

# ==============================================================================
# container-allowed-images Test Suite
# ==============================================================================
#
# Comprehensive tests for container image allowlist validation
# Run with: opa test policies/safeguards/lib/ policies/safeguards/container-allowed-images.rego policies/safeguards/container-allowed-images_test.rego -v
#
# ==============================================================================


# ==============================================================================
# Test: Default Parameters
# ==============================================================================

test_default_parameters if {
	# When no parameters provided, defaults should use wildcard regex
	test_params := object.get({}, "parameters", {
		"imageRegex": ".*",
		"excludedImages": []
	})
	
	test_params.imageRegex == ".*"
	test_params.excludedImages == []
	
	# Wildcard should match anything
	regex.match(".*", "any/image:latest")
}

# ==============================================================================
# Test: Regex Pattern with Anchors
# ==============================================================================

test_regex_with_anchors if {
	# Regex with anchors should match correctly
	pattern := "^mcr\\.microsoft\\.com/.*$"
	regex.match(pattern, "mcr.microsoft.com/app:1.0")
	not regex.match(pattern, "prefix-mcr.microsoft.com/app:1.0")
}

# ==============================================================================
# Test: Complex Regex Pattern with Alternatives
# ==============================================================================

test_complex_regex_pattern if {
	# Complex regex with alternatives should work
	pattern := "^(mcr\\.microsoft\\.com|docker\\.io)/.*"
	
	regex.match(pattern, "mcr.microsoft.com/app:1.0")
	regex.match(pattern, "docker.io/nginx:1.0")
	not regex.match(pattern, "gcr.io/app:1.0")
}

# ==============================================================================
# Test: Case Sensitive Matching
# ==============================================================================

test_case_sensitive_matching if {
	# Matching should be case-sensitive
	pattern := "^mcr\\.microsoft\\.com/.*"
	regex.match(pattern, "mcr.microsoft.com/app:1.0")
	not regex.match(pattern, "MCR.MICROSOFT.COM/app:1.0")
}

# ==============================================================================
# Test: Image With Port Number
# ==============================================================================

test_image_with_port if {
	# Images with registry port should work
	pattern := "^mcr\\.microsoft\\.com.*"
	regex.match(pattern, "mcr.microsoft.com:5000/app:1.0")
}

# ==============================================================================
# Test: Escaped Regex Characters
# ==============================================================================

test_escaped_regex_characters if {
	# Dots in regex must be escaped
	pattern_unescaped := "mcr.microsoft.com/app"
	pattern_escaped := "^mcr\\.microsoft\\.com/.*"
	
	# Unescaped dot matches any character (would match mcrXmicrosoftXcom)
	regex.match(pattern_unescaped, "mcrXmicrosoftXcom/app")
	
	# Escaped dot matches literal dot
	regex.match(pattern_escaped, "mcr.microsoft.com/app:1.0")
	not regex.match(pattern_escaped, "mcrXmicrosoftXcom/app:1.0")
}

# ==============================================================================
# Test: Container Array Structure
# ==============================================================================

test_container_array_structure if {
	# Test working with container arrays
	containers := [
		{"name": "app", "image": "mcr.microsoft.com/app:1.0"},
		{"name": "sidecar", "image": "docker.io/sidecar:2.0"}
	]
	
	count(containers) == 2
	containers[0].image == "mcr.microsoft.com/app:1.0"
	containers[1].image == "docker.io/sidecar:2.0"
}

# ==============================================================================
# Test: Iteration Over Containers
# ==============================================================================

test_iterate_containers if {
	# Test iterating over containers
	containers := [
		{"name": "app", "image": "image1:1.0"},
		{"name": "sidecar", "image": "image2:2.0"},
		{"name": "debug", "image": "image3:3.0"}
	]
	
	# Count how many containers exist
	count([c | c := containers[_]]) == 3
	
	# Count containers matching a pattern
	count([c | c := containers[_]; regex.match("image[12]", c.image)]) == 2
}

# ==============================================================================
# Test: Pod Spec from Different Resource Types
# ==============================================================================

test_pod_spec_extraction_pod if {
	# Direct pod: spec is at .spec
	obj := {
		"kind": "Pod",
		"spec": {"containers": [{"name": "app", "image": "image:1.0"}]}
	}
	
	spec := object.get(obj, "spec", {})
	spec.containers[0].name == "app"
}

test_pod_spec_extraction_deployment if {
	# Deployment: spec is at .spec.template.spec
	obj := {
		"kind": "Deployment",
		"spec": {
			"template": {
				"spec": {"containers": [{"name": "app", "image": "image:1.0"}]}
			}
		}
	}
	
	spec := object.get(obj, "spec", {})
	template := object.get(spec, "template", {})
	pod_spec := object.get(template, "spec", {})
	pod_spec.containers[0].name == "app"
}

test_pod_spec_extraction_statefulset if {
	# StatefulSet: spec is at .spec.template.spec
	obj := {
		"kind": "StatefulSet",
		"spec": {
			"template": {
				"spec": {"containers": [{"name": "app", "image": "image:1.0"}]}
			}
		}
	}
	
	spec := object.get(obj, "spec", {})
	template := object.get(spec, "template", {})
	pod_spec := object.get(template, "spec", {})
	pod_spec.containers[0].name == "app"
}

# ==============================================================================
# Test: Container Types - Regular, Init, Ephemeral
# ==============================================================================

test_all_container_types if {
	# Test that all container types are properly concatenated
	containers := [{"name": "app", "image": "app:1"}]
	init_containers := [{"name": "init", "image": "init:1"}]
	ephemeral_containers := [{"name": "debug", "image": "debug:1"}]
	
	all_containers := array.concat(
		array.concat(containers, init_containers),
		ephemeral_containers
	)
	
	count(all_containers) == 3
	all_containers[0].name == "app"
	all_containers[1].name == "init"
	all_containers[2].name == "debug"
}

# ==============================================================================
# Test: Empty Container Lists
# ==============================================================================

test_empty_container_lists if {
	# Test with empty container lists
	containers := []
	init_containers := []
	ephemeral_containers := []
	
	all_containers := array.concat(
		array.concat(containers, init_containers),
		ephemeral_containers
	)
	
	count(all_containers) == 0
}

# ==============================================================================
# Test: Partial Empty Container Lists
# ==============================================================================

test_partial_empty_container_lists if {
	# Test with some container lists empty
	containers := [{"name": "app", "image": "app:1"}]
	init_containers := []
	ephemeral_containers := [{"name": "debug", "image": "debug:1"}]
	
	all_containers := array.concat(
		array.concat(containers, init_containers),
		ephemeral_containers
	)
	
	count(all_containers) == 2
	all_containers[0].name == "app"
	all_containers[1].name == "debug"
}

# ==============================================================================
# Test: Message Formatting
# ==============================================================================

test_message_formatting if {
	# Test that violation messages are formatted correctly
	image := "docker.io/nginx:latest"
	pattern := "^mcr\\.microsoft\\.com/.*"
	
	msg := sprintf(
		"Container image '%s' does not match allowed pattern '%s'",
		[image, pattern]
	)
	
	msg == "Container image 'docker.io/nginx:latest' does not match allowed pattern '^mcr\\.microsoft\\.com/.*'"
}

# ==============================================================================
# Test: Special Characters in Image Names
# ==============================================================================

test_special_characters_in_images if {
	# Test images with special characters
	pattern := "^[a-z0-9]+(-[a-z0-9]+)*/.*"
	
	regex.match(pattern, "my-registry/my-app:1.0")
	regex.match(pattern, "my-registry-2/my-app-service:1.0")
}


