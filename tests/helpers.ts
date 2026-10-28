import assert from "node:assert/strict";
import type { z } from "zod";

export async function readJson<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  const value: unknown = await response.json();
  return schema.parse(value);
}
export function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  assert.ok(value !== null, `Missing response header: ${name}`);
  return value;
}
