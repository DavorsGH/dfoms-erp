export async function preserveScrollDuringAction<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const scrollY = window.scrollY;
  try {
    return await operation();
  } finally {
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
    });
  }
}
