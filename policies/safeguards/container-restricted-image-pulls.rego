package safeguards.container_restricted_image_pulls

import data.safeguards.lib as lib

# ==============================================================================
# container-restricted-image-pulls Safeguard Rule
# ==============================================================================
#
# Checks if imagePullSecrets are configured in pod specs.
# Returns as WARNING (not violation) when imagePullSecrets are missing,
# following Azure Draft safeguard specification.
#
# Reference: https://github.com/Azure/draft/blob/main/pkg/safeguards/lib/v1.0.0/container-restricted-image-pulls/template.yaml
#

# Return warnings for missing or empty imagePullSecrets
warnings contains result if {
	# Extract pod spec from input resource
	pod_spec := lib.get_pod_spec(input.review.object)
	
	# Get resource kind and name
	kind := object.get(input.review.object, "kind", "Unknown")
	name := object.get(object.get(input.review.object, "metadata", {}), "name", "Unknown")
	
	# Check if imagePullSecrets is missing or empty
	pull_secrets := object.get(pod_spec, "imagePullSecrets", [])
	count(pull_secrets) == 0
	
	# Generate warning
	result := {
		"msg": sprintf("Pod spec in %s '%s' has no imagePullSecrets - unauthenticated image pulls", [kind, name]),
		"details": {
			"resource": name,
			"resourceKind": kind,
			"warningType": "missing-image-pull-secrets"
		}
	}
}
