import type { StartedTestContainer } from 'testcontainers';

export default async function globalTeardown(): Promise<void> {
  const started = (globalThis as unknown as { __gdContainers?: Record<string, StartedTestContainer> }).__gdContainers;
  if (!started) return;
  await Promise.all(Object.values(started).map((c) => c.stop({ timeout: 5000 })));
}
