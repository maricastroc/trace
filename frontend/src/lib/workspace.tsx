"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, request } from "./api";
import type { Workspace } from "./types";

const STORAGE_KEY = "trace.workspace-token";

type WorkspaceState =
  | { status: "loading"; message: string }
  | { status: "ready"; token: string; workspace: Workspace; renewed: boolean }
  | { status: "error"; error: ApiError };

const WorkspaceContext = createContext<{ state: WorkspaceState; retry: () => void } | null>(null);

function readToken() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {}
}

let pending: Promise<{ token: string; workspace: Workspace; renewed: boolean }> | null = null;

async function resolveWorkspace() {
  const stored = readToken();

  if (stored) {
    try {
      const { data } = await request<{ data: Workspace }>("/workspace", { token: stored });
      return { token: stored, workspace: data, renewed: false };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
  }

  const { data } = await request<{ data: Workspace & { token: string } }>("/workspaces", { method: "POST" });
  writeToken(data.token);
  return { token: data.token, workspace: data, renewed: stored !== null };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>({ status: "loading", message: "Abrindo seu espaço de investigação" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    pending ??= resolveWorkspace();
    pending
      .then((result) => active && setState({ status: "ready", ...result }))
      .catch((error) => {
        pending = null;
        if (active) {
          setState({ status: "error", error: error instanceof ApiError ? error : new ApiError(String(error), 0, "unknown") });
        }
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    pending = null;
    setState({ status: "loading", message: "Tentando novamente" });
    setAttempt((value) => value + 1);
  }, []);

  return <WorkspaceContext.Provider value={{ state, retry }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}

export function useToken() {
  const { state } = useWorkspace();
  return state.status === "ready" ? state.token : null;
}
