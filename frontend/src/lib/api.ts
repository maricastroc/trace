export const API_URL = (process.env.NEXT_PUBLIC_TRACE_API_URL ?? "http://localhost:8000/api/v1").replace(/\/$/, "");

export const WORKSPACE_HEADER = "X-Trace-Workspace";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }

  get isUnreachable() {
    return this.status === 0;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
};

export async function request<T>(path: string, { method = "GET", body, token, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers[WORKSPACE_HEADER] = token;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(`Não foi possível conectar à API do Trace em ${API_URL}.`, 0, "network.unreachable");
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      payload?.message ?? `A API respondeu com o status ${response.status}.`,
      response.status,
      payload?.code ?? (payload?.errors ? "validation" : "http_error"),
      payload?.details ?? payload?.errors ?? {},
    );
  }

  return payload as T;
}

export function query(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
