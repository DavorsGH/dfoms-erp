declare module "pg" {
  export class Client {
    constructor(config?: {
      connectionString?: string | null;
      ssl?: boolean | { rejectUnauthorized?: boolean };
    });
    connect(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<{
      rows: Record<string, unknown>[];
      rowCount: number | null;
    }>;
    end(): Promise<void>;
  }
}
