/** Passed to dashboard / portal auth helpers from Route Handlers (app/api/*). */
export type MiddlewareAuthLoadOptions = {
  /** When true, never verify x-dfoms-auth-context (client header may be spoofed). */
  skipMiddlewareTrust?: boolean;
};

export const ROUTE_HANDLER_AUTH_OPTS: MiddlewareAuthLoadOptions = {
  skipMiddlewareTrust: true,
};

/** Badge count polls on the four notification APIs may use proxy signed context. */
export const BADGE_POLL_AUTH_OPTS: MiddlewareAuthLoadOptions | undefined =
  undefined;
