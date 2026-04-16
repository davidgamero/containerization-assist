package containerization.maven_sources

import rego.v1

default allow := false

allowed_repositories := {
  "https://repo.maven.apache.org/maven2",
  "https://repo1.maven.org/maven2",
}

violations contains result if {
  input_type == "package"
  some repo in input.maven_repositories
  repo.url != ""
  not repo_allowed(repo.url)
  result := {
    "rule": "maven-source-allowlist",
    "category": "security",
    "priority": 90,
    "severity": "block",
    "message": concat("", ["Maven repository '", repo.url, "' is not in the approved list."]),
    "description": "Only approved Maven repositories may be used",
  }
}

repo_allowed(url) if {
  some allowed in allowed_repositories
  startswith(url, allowed)
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
