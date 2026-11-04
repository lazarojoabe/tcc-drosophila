import type { AuditEntry, Batch, Config, Job, Result, SavedSession, Session } from "./types";

export type HistogramKind = "protein" | "nucleus" | "standard-deviation";

export interface AccessStatus {
  authentication_required: boolean;
  authenticated: boolean;
}

const tokenKey = "nuclei-review-access-token";
let accessToken = sessionStorage.getItem(tokenKey) ?? "";
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "/api" : "http://localhost:8000/api");

export function clearAccessToken() {
  accessToken = "";
  sessionStorage.removeItem(tokenKey);
}
function setAccessToken(token: string) {
  accessToken = token;
  sessionStorage.setItem(tokenKey, token);
}
function withAccessToken(url: string) {
  if (!accessToken) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}access_token=${encodeURIComponent(accessToken)}`;
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API}${url}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.detail?.message ?? body.detail ?? `Erro HTTP ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}
export const getAccessStatus = () => request<AccessStatus>("/auth/status");
export async function login(accessCode: string) {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_code: accessCode }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? "Não foi possível validar o código de acesso");
  }
  const result = (await response.json()) as { access_token: string | null };
  if (result.access_token) setAccessToken(result.access_token);
}
export function createSession(
  nucleus: File,
  protein: File | null,
  config: Config,
): Promise<Session> {
  const form = new FormData();
  form.append("nucleus_file", nucleus);
  if (protein) form.append("protein_file", protein);
  form.append("config_json", JSON.stringify(config));
  return request<Session>("/sessions", { method: "POST", body: form });
}
export function createBatch(
  nuclei: File[],
  proteins: File[],
  config: Config,
): Promise<Batch> {
  const form = new FormData();
  nuclei.forEach((file) =>
    form.append("nucleus_files", file, file.webkitRelativePath || file.name),
  );
  proteins.forEach((file) =>
    form.append("protein_files", file, file.webkitRelativePath || file.name),
  );
  form.append("config_json", JSON.stringify(config));
  return request<Batch>("/batches", { method: "POST", body: form });
}
export const getBatch = (id: string) => request<Batch>(`/batches/${id}`);
export const listSessions = () => request<SavedSession[]>("/sessions");
export const batchHistogramUrl = (
  id: string,
  kind: HistogramKind,
) => withAccessToken(`${API}/batches/${id}/histogram/${kind}.png`);
export const batchCsvUrl = (id: string) => withAccessToken(`${API}/batches/${id}/export.csv`);
export const batchPackageUrl = (id: string) => withAccessToken(`${API}/batches/${id}/export.zip`);
export const sessionHistogramUrl = (id: string, kind: HistogramKind) =>
  withAccessToken(`${API}/sessions/${id}/histogram/${kind}.png`);
export const getResult = (id: string) =>
  request<Result>(`/sessions/${id}/result`);
export const getHistory = (id: string) =>
  request<AuditEntry[]>(`/sessions/${id}/history`);
export const saveSession = (id: string, reviewer?: string) =>
  request<Result>(`/sessions/${id}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewer }),
  });
export const saveBatch = (id: string, reviewer?: string) =>
  request<Batch>(`/batches/${id}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewer }),
  });
export const getJob = (id: string) => request<Job>(`/jobs/${id}`);
export function edit(id: string, payload: Record<string, unknown>) {
  return request<Result>(`/sessions/${id}/edits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
export function undo(id: string, revision: number, reviewer?: string) {
  return request<Result>(`/sessions/${id}/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_revision: revision, reviewer }),
  });
}
export function redo(id: string, revision: number, reviewer?: string) {
  return request<Result>(`/sessions/${id}/redo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_revision: revision, reviewer }),
  });
}
export function reprocess(
  id: string,
  revision: number,
  config: Config,
  reviewer?: string,
) {
  return request<Job>(`/sessions/${id}/reprocess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_revision: revision, config, reviewer }),
  });
}
export function imageUrl(id: string, kind: "nucleus" | "protein" | "mask") {
  return withAccessToken(`${API}/sessions/${id}/images/${kind}.png`);
}
export function exportUrl(id: string, format: "csv" | "json" | "zip") {
  return withAccessToken(`${API}/sessions/${id}/export.${format}`);
}
export function subscribeJob(
  id: string,
  onJob: (job: Job) => void,
  onDone: () => void,
) {
  const source = new EventSource(withAccessToken(`${API}/sessions/${id}/events`));
  let finished = false;
  let polling: number | undefined;
  const finish = (job: Job) => {
    if (finished) return;
    onJob(job);
    if (["completed", "error"].includes(job.status)) {
      finished = true;
      source.close();
      if (polling !== undefined) window.clearInterval(polling);
      onDone();
    }
  };
  source.addEventListener("job", (event) =>
    finish(JSON.parse((event as MessageEvent).data) as Job),
  );
  source.onerror = () => source.close();
  polling = window.setInterval(() => {
    void getJob(id)
      .then(finish)
      .catch(() => undefined);
  }, 1000);
  return () => {
    finished = true;
    source.close();
    if (polling !== undefined) window.clearInterval(polling);
  };
}
