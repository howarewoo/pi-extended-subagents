# Security policy

## Reporting a vulnerability

Please report suspected security vulnerabilities privately through
[GitHub's vulnerability reporting form](https://github.com/howarewoo/pi-extended-subagents/security/advisories/new).
Do not disclose vulnerabilities, credentials, or sensitive reproduction details in public
issues or pull requests.

Include the affected version, reproduction steps, and potential impact. Remove API keys,
tokens, personal data, and private repository content from logs and examples.

## Supported versions

Security fixes target the latest published release. Please upgrade to the latest release
before reporting a problem, when possible.

## Trust boundaries

This extension runs delegated agents with access to tools and local project content.
Treat tool access as a permission boundary, not as an operating-system sandbox. Review
agent permissions and only run the extension in projects you trust. Do not include secrets
in prompts, task files, or checked-in configuration.
