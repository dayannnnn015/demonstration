import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // The workspace screens are rendered in tests/web-screens.test.ts, so JSX has
  // to compile here even though the backend tsconfig deliberately excludes web/.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  /*
   * .local/ holds scratch probes and credentials, never part of the suite; a
   * probe left there must not run with it. `.claude/` is the same rule for the
   * same reason: it holds git worktrees (`git worktree list` shows them), and a
   * worktree is a **whole second copy of this repository on another branch**.
   * Left in, a root run discovers both copies of all 27 test files and runs the
   * other branch's in-progress tests against this branch's expectations — which
   * is how a suite reports 55 files and fails on a module this branch has never
   * had. Exclude the directory, not the branch: which worktrees exist is a
   * working detail, and `.git/info/exclude` already keeps them out of git.
   */
  test: { testTimeout: 20000, hookTimeout: 60000, fileParallelism: false, exclude: [...configDefaults.exclude, '.local/**', 'output/**', '.claude/**'] },
});
