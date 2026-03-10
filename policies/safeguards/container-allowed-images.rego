package safeguards.container_allowed_images

import data.safeguards.lib

# ==============================================================================
# container-allowed-images Safeguard Rule
# ==============================================================================
#
# Validates that ALL containers (including init and ephemeral) use images
# matching an allowlist regex pattern. This implements the Azure Draft
# safeguard: https://github.com/Azure/draft/blob/main/pkg/safeguards/lib/v1.0.0/container-allowed-images/template.yaml
#
# Parameters:
#   - imageRegex: Regex pattern for allowed container images (default: ".*")
#   - excludedImages: List of image prefix strings to exclude from checking (default: [])
#
# Note: excludedImages uses prefix matching (startswith), not regex matching,
#       following Azure Draft behavior.
#
# ==============================================================================

# Get parameters with defaults
parameters := object.get(input, "parameters", {
	"imageRegex": ".*",
	"excludedImages": []
})

# Check if image matches the allowed regex pattern
is_allowed_image(image, regex_pattern) if {
	regex.match(regex_pattern, image)
}

# Check if image is in the excluded list (prefix matching)
is_excluded(image, excluded_list) if {
	some excluded in excluded_list
	startswith(image, excluded)
}

# Get the pod spec from the input object
pod_spec := lib.get_pod_spec(input.review.object)

# Generate violations for non-matching container images
violations contains result if {
	# Get all containers (init, regular, and ephemeral)
	containers := lib.get_all_containers(pod_spec)
	
	# Iterate over all containers
	container := containers[_]
	
	# Get the image from the container
	image := container.image
	
	# Check if image is excluded
	not is_excluded(image, parameters.excludedImages)
	
	# Check if image matches the required regex
	not is_allowed_image(image, parameters.imageRegex)
	
	# Generate violation result
	result := {
		"rule": "container-allowed-images",
		"image": image,
		"allowedPattern": parameters.imageRegex,
		"message": sprintf(
			"Container image '%s' does not match allowed pattern '%s'",
			[image, parameters.imageRegex]
		)
	}
}
