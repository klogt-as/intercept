# Release Process

This document describes how to create a new release of `@klogt/intercept`.

## Automated Release Process

The project uses GitHub Actions to automatically create GitHub Releases from the CHANGELOG.md when you push a version tag.

## Steps to Release

### 1. Update the Changelog

Ensure `CHANGELOG.md` has an entry for the new version under `## [Unreleased]`:

```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature descriptions...

### Changed
- Changed feature descriptions...

### Fixed
- Bug fix descriptions...
```

### 2. Run the Release Command

```bash
npm run release
```

This command will:
1. Run `bumpp` which prompts you to select the version bump (patch, minor, major)
2. Update `package.json` version
3. Update `CHANGELOG.md` (moving content from Unreleased to the new version)
4. Create a git commit with the version bump
5. Create a git tag (e.g., `v2.0.1`)
6. Push the commit and tag to GitHub
7. Publish to npm

### 3. Automatic GitHub Release Creation

Once the tag is pushed:
1. GitHub Actions workflow (`.github/workflows/release.yml`) triggers automatically
2. The workflow extracts the changelog section for the new version
3. A GitHub Release is created at https://github.com/klogt-as/intercept/releases
4. The release notes are populated with the changelog content

## Version Tag Formats

The workflow supports both tag formats:
- `v2.0.1` (with 'v' prefix)
- `2.0.1` (without prefix)

## Manual GitHub Release Creation

If you need to create a release manually or the workflow fails:

1. Go to https://github.com/klogt-as/intercept/releases/new
2. Select the version tag
3. Copy the relevant section from CHANGELOG.md
4. Paste it as the release description
5. Click "Publish release"

## Troubleshooting

### Workflow doesn't trigger
- Ensure the tag was pushed: `git push --tags`
- Check that the tag format matches `v*.*.*` or `*.*.*`

### Changelog extraction fails
- Verify the version exists in CHANGELOG.md with the format: `## [X.Y.Z] - YYYY-MM-DD`
- Ensure there's content between this version header and the next `## [` header

### Release creation fails
- Check the workflow logs at https://github.com/klogt-as/intercept/actions
- Verify the GitHub Actions permissions are set correctly (Settings → Actions → General → Workflow permissions)
