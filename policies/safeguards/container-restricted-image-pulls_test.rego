package safeguards.container_restricted_image_pulls_test

import data.safeguards.container_restricted_image_pulls

# Test: Pod without imagePullSecrets should generate warning
test_pod_no_image_pull_secrets if {
	result := container_restricted_image_pulls.warnings with input as {
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
	count(result) == 1
	result[_].msg == "Pod spec in Pod 'test-pod' has no imagePullSecrets - unauthenticated image pulls"
	result[_].details.warningType == "missing-image-pull-secrets"
}

# Test: Pod with imagePullSecrets should not generate warning
test_pod_with_image_pull_secrets if {
	result := container_restricted_image_pulls.warnings with input as {
		"review": {
			"object": {
				"kind": "Pod",
				"metadata": {"name": "test-pod", "namespace": "default"},
				"spec": {
					"containers": [{"name": "app", "image": "nginx:latest"}],
					"imagePullSecrets": [{"name": "my-secret"}]
				}
			}
		},
		"parameters": {}
	}
	count(result) == 0
}

# Test: Pod with empty imagePullSecrets array should generate warning
test_pod_empty_image_pull_secrets if {
	result := container_restricted_image_pulls.warnings with input as {
		"review": {
			"object": {
				"kind": "Pod",
				"metadata": {"name": "test-pod", "namespace": "default"},
				"spec": {
					"containers": [{"name": "app", "image": "nginx:latest"}],
					"imagePullSecrets": []
				}
			}
		},
		"parameters": {}
	}
	count(result) == 1
	result[_].msg == "Pod spec in Pod 'test-pod' has no imagePullSecrets - unauthenticated image pulls"
}

# Test: Deployment without imagePullSecrets should generate warning
test_deployment_no_image_pull_secrets if {
	result := container_restricted_image_pulls.warnings with input as {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deploy", "namespace": "default"},
				"spec": {
					"template": {
						"spec": {
							"containers": [{"name": "app", "image": "nginx:latest"}]
						}
					}
				}
			}
		},
		"parameters": {}
	}
	count(result) == 1
	result[_].msg == "Pod spec in Deployment 'test-deploy' has no imagePullSecrets - unauthenticated image pulls"
}

# Test: Deployment with imagePullSecrets should not generate warning
test_deployment_with_image_pull_secrets if {
	result := container_restricted_image_pulls.warnings with input as {
		"review": {
			"object": {
				"kind": "Deployment",
				"metadata": {"name": "test-deploy", "namespace": "default"},
				"spec": {
					"template": {
						"spec": {
							"containers": [{"name": "app", "image": "nginx:latest"}],
							"imagePullSecrets": [{"name": "registry-secret"}]
						}
					}
				}
			}
		},
		"parameters": {}
	}
	count(result) == 0
}

# Test: StatefulSet without imagePullSecrets should generate warning
test_statefulset_no_image_pull_secrets if {
	result := container_restricted_image_pulls.warnings with input as {
		"review": {
			"object": {
				"kind": "StatefulSet",
				"metadata": {"name": "test-stateful", "namespace": "default"},
				"spec": {
					"template": {
						"spec": {
							"containers": [{"name": "app", "image": "nginx:latest"}]
						}
					}
				}
			}
		},
		"parameters": {}
	}
	count(result) == 1
	result[_].details.resourceKind == "StatefulSet"
}

# Test: DaemonSet with imagePullSecrets should not generate warning
test_daemonset_with_image_pull_secrets if {
	result := container_restricted_image_pulls.warnings with input as {
		"review": {
			"object": {
				"kind": "DaemonSet",
				"metadata": {"name": "test-daemon", "namespace": "default"},
				"spec": {
					"template": {
						"spec": {
							"containers": [{"name": "app", "image": "nginx:latest"}],
							"imagePullSecrets": [{"name": "secret"}]
						}
					}
				}
			}
		},
		"parameters": {}
	}
	count(result) == 0
}
