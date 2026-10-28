export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(!isForm && init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.error || `요청을 처리하지 못했어요 (${response.status}).`,
      response.status,
      body.code || "REQUEST_FAILED",
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const json = (value: unknown) => JSON.stringify(value);
export const errorText = (error: unknown) =>
  error instanceof ApiError && error.status === 409
    ? `다른 변경 사항이 있거나 연결된 항목이 남아 있어요. ${error.message} 최신 상태를 확인한 뒤 다시 시도해 주세요.`
    : error instanceof Error
      ? error.message
      : "잠시 후 다시 시도해 주세요.";
