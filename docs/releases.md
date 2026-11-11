# Release guide

Publish deliberate, versioned npm releases. GitHub releases use the matching entry from
`CHANGELOG.md`; Pi owns installation and updates. Publishing executes no live model calls.
The repository workflows do not publish on ordinary main-branch pushes.

## Version and compatibility policy

- During 0.x, use a patch for compatible fixes and polish, and a minor for new functionality
  or breaking changes. Label breaking changes and explain migration in the changelog.
- Move to 1.0 when the public tool and configuration contracts are stable. After 1.0,
  use semantic versioning: major for breaking changes, minor for compatible features,
  patch for compatible fixes.
- Tool arguments, permissions/grants, configuration, commands and artifact formats are
  user-facing contracts. A small implementation change can still require a breaking release.
- This pipeline publishes stable versions to npm's `latest` channel. Prerelease versions
  are rejected until a separate channel policy is added.
- The current tested host is Pi 1.5.2. Wildcard host peer dependencies follow Pi's packaging
  requirements; they do not promise compatibility with every Pi version. Keep host development
  dependencies pinned and verify SDK/CLI lifecycle, permission, cancellation/drain and native
  rendering behavior before changing the documented Pi baseline.
- Never move a release tag, reuse a published version or overwrite retained user artifacts.

## One-time setup

A repository owner and an npm package owner must complete these steps. They are not performed
by the local setup scripts.

1. Ensure `pi-extended-subagents` is available to your npm account. The name was not found in
   the public registry during setup; that is not a reservation or proof of publishing rights.
2. Enable GitHub Actions for this repository. Create a GitHub environment named `npm`.
   Add a required reviewer if desired, and restrict deployment refs to release tags (`v*`).
   Protect `main` with the two CI matrix checks and restrict creation/deletion of `v*` tags
   to release maintainers using repository rulesets.
3. Bootstrap the package with the first manual npm publish below. A trusted publisher is
   normally configured from an existing package's settings, so do not assume the first
   tag-triggered run can create a new npm package without account setup.
4. In the npm package's **Settings → Trusted publishing**, add GitHub Actions with:

   | Field                | Value                   |
   | -------------------- | ----------------------- |
   | Organization or user | `howarewoo`             |
   | Repository           | `pi-extended-subagents` |
   | Workflow filename    | `release.yml`           |
   | Environment name     | `npm`                   |

   Permit direct `npm publish` if npm presents an allowed-actions selector. The workflow uses
   GitHub-hosted runners and `id-token: write`; no `NPM_TOKEN` secret is needed. Use npm
   11.5.1 or newer for OIDC publishing (the release runner uses Node 24).

5. Follow npm's current validation/expiry rules when creating the trusted publisher; create it
   near the next release. After successful OIDC publication, restrict traditional token-based
   publishing and revoke unused automation tokens. Public GitHub/OIDC publication supplies npm
   provenance automatically.

See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for
current account requirements and troubleshooting. Do not use `npm whoami` to test OIDC: it does
not validate trusted publishing permissions.

## Prepare each release

1. Start from current `main`, with no unrelated local changes. Review the changes being released.
2. On a release-preparation branch, update the manifest and lockfile without creating a tag:

   ```sh
   npm version 0.1.1 --no-git-tag-version
   ```

   Choose the actual next version; `0.1.0` is already prepared for the first release.

3. Add a nonempty `## [0.1.1]` entry to the root changelog, using the selected version. Include
   changes, migrations, Pi compatibility, and relevant permission/lifecycle changes. Do not
   promise verification that has not run. Keep the README's installation status and examples
   current when the first npm version becomes available.
4. Run the local gates:

   ```sh
   npm ci --ignore-scripts
   npm run check
   npm run release:check
   npm run test:package
   ```

   Package smoke testing installs only runtime dependencies, without host peers or lifecycle
   scripts, in a disposable directory. It checks the packed manifest, changelog, license,
   production extension load and tool registration, not live-provider reliability.

5. Submit the version/changelog changes as a human-reviewed release PR and merge it after CI.
   These instructions describe maintainer actions; the setup task does not commit or publish.

CI runs all checks and the package smoke test on Node 22.19.0 and Node 24. It uses pinned Pi
1.5.2 development packages, not an implied matrix of all Pi versions.

## First npm publish only

After the first release PR is merged, check out its exact clean commit and run the local gates
above. Use an npm account with publishing rights and two-factor authentication:

```sh
npm login
release_dir="$(mktemp -d)"
npm pack --pack-destination "$release_dir"
npm run test:package -- "$release_dir/pi-extended-subagents-0.1.0.tgz"
npm publish "$release_dir/pi-extended-subagents-0.1.0.tgz" --access public
```

Inspect the result with `npm view pi-extended-subagents@0.1.0 version dist.integrity`.
Keep the tarball until verified, then remove the temporary directory. This interactive bootstrap
is separate from GitHub OIDC and does not claim GitHub provenance. Configure the trusted publisher
before pushing the release tag. The workflow accepts an already-published version only when its
registry SHA-512 integrity matches the newly verified tarball byte for byte.

## Tag and publish

From the exact merged release commit (replace the example version as needed):

```sh
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

`release.yml` verifies that the commit belongs to `main`, the tag matches the manifest and
lockfile versions, and a matching changelog entry exists. It runs all checks, packs once,
installs/smoke-tests that tarball, publishes the same tarball to npm, then creates the GitHub
release with the extracted notes. The `npm` environment can require human approval. Releases
serialize; a later tag does not cancel an active publish.

Verify both the npm version/integrity and the GitHub release before announcing it. Test a clean
Pi install, then `/task-profiles`, and confirm the documented update path. No tag, registry publish,
trusted-publisher setting or fresh installed-package user walkthrough is performed by local CI checks.

## Recover a partial or bad release

- **Failed before npm publication:** fix the configuration or external prerequisite, then rerun
  the workflow for the same tag. Do not move the tag to a changed commit.
- **npm published, GitHub release failed:** rerun the failed workflow, or dispatch **Release**
  on the same existing tag. It skips npm publication only when that version's integrity exactly
  matches the verified tarball. An existing GitHub release is left unchanged. A different integrity
  or a registry error stops the workflow; do not bypass the check.
- **Published contents are wrong:** prepare a new patch (or appropriate breaking version), with
  clear changelog guidance. Deprecate the affected version with an explanatory npm message if
  needed; do not unpublish as the normal rollback strategy.
- **User rollback:** let tasks finish, explicitly install the last known-good version, then
  restart Pi. For example, `pi install npm:pi-extended-subagents@0.1.0` once that version exists.
  Pinning code does not undo incompatible configuration or data changes; follow release-specific
  migration instructions. Reload and shutdown abort/drain active children rather than migrate them.
