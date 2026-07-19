export const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: "no-store",
  });
