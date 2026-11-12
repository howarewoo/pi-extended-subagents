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

## Local task storage

New task and successor-generation directories, including extension-owned `agent/` and
`transcripts/` directories, are created with POSIX mode `0700` (subject to further
restriction by the process umask). Fixed outcome artifacts retain exclusive publication
and mode `0600`. SDK transcript files remain SDK-managed; their enclosing private
directories restrict access by other OS users even under a permissive umask.

This applies only to newly created records. Historical records, existing files, parent
session directories and global storage permissions are not changed or migrated. Review
older records separately if they may contain sensitive prompts, tool output or results.
On Windows, Node's POSIX mode bits do not establish equivalent access control: privacy
depends on the account and inherited filesystem ACLs. These modes are not an ACL
framework or a sandbox against the same OS account, privileged processes, delegated
tools or external filesystem changes. Protect parent session storage accordingly.
