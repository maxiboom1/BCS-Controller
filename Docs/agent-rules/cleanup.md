# Reusable Cleanup Rules

1. Do not include temporary outputs or generated local-check artifacts in the delivered source changes.
2. Use the repository's maintained cleanup and cleanliness tools. Verify actual absence rather than relying on a prose-only cleanup claim.
3. Keep cleanup recursive within the maintained repository tree. Skip version-control internals and installed dependencies, and do not follow symlinks outside the repository.
4. Before a recursive deletion or move, verify that every resolved target is inside the intended workspace or an explicitly authorized target directory.
5. Cleanliness reports should use sorted repository-relative paths so that findings are deterministic and easy to review.
