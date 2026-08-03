// Shared across e2e specs. Each test run uses a unique suffix so tests
// never collide with each other or with real accounts, and can be re-run
// against the same environment repeatedly without cleanup.
export function unique(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

export function testEmail(label: string): string {
  return `e2e-${label}-${unique()}@example.com`;
}
