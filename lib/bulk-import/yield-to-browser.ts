/** Lets React paint loading UI before heavy synchronous work on the main thread. */
export async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
