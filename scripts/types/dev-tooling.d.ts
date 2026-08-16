/** Ambient types for dev-only script dependencies (not checked during `next build`). */
declare module "pg" {
  export class Client {
    constructor(config?: unknown);
    connect(): Promise<void>;
    query(
      sql: string,
      params?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
    end(): Promise<void>;
  }
}

declare module "playwright";

declare module "web-push";
