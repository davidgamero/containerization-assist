package containerization.npm_registry

import rego.v1

default allow := false

allowed_registries := {
  "https://registry.npmjs.org",
  "https://registry.npmjs.org/",
}

violations contains result if {
  input_type == "package"
  registry := input.npmrc_registry
  registry != ""
  not registry_allowed(registry)
  result := {
    "rule": "npm-registry-allowlist",
    "category": "security",
    "priority": 90,
    "severity": "block",
    "message": concat("", ["npm registry '", registry, "' is not in the approved list. Use an approved registry."]),
    "description": "Only approved npm registries may be used",
  }
}

registry_allowed(registry) if {
  some allowed in allowed_registries
  startswith(registry, allowed)
}

input_type := "package" if {
  input.type == "package"
}

input_type := "package" if {
  input.type == "context"
}

allow if {
  count(violations) == 0
}

result := {
  "allow": allow,
  "violations": violations,
  "warnings": set(),
  "suggestions": set(),
  "summary": {
    "total_violations": count(violations),
    "total_warnings": 0,
    "total_suggestions": 0,
  },
}
