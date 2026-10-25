"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, request } from "./api";
import { forgetToken, readScenario, readTokens, writeScenario, writeToken, type KeyValueStorage } from "./scenario-storage";
import type { Meta, ScenarioSummary, Workspace } from "./types";

type ReadyState = {
  status: "ready";
  token: string;
  workspace: Workspace;
  scenario: string;
  scenarios: ScenarioSummary[];
  demoNotice: string;
  renewed: boolean;
};

type WorkspaceState =
  | { status: "loading"; message: string }
  | ReadyState
  | { status: "error"; error: ApiError };

type WorkspaceContextValue = {
  state: WorkspaceState;
  retry: () => void;
  switchScenario: (scenario: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function openWorkspace(scenario: string) {
  const storage = browserStorage();
  const stored = readTokens(storage)[scenario];

  if (stored) {
    try {
      const { data } = await request<{ data: Workspace }>("/workspace", { token: stored });
      if (data.scenario?.key === scenario) return { token: stored, workspace: data, renewed: false };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    forgetToken(storage, scenario);
  }

  const { data } = await request<{ data: Workspace & { token: string } }>("/workspaces", { method: "POST", body: { scenario } });
  writeToken(storage, scenario, data.token);
  return { token: data.token, workspace: data, renewed: stored !== undefined };
}

function asApiError(error: unknown) {
  return error instanceof ApiError ? error : new ApiError(String(error), 0, "unknown");
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>({ status: "loading", message: "Abrindo seu espaço de investigação" });
  const meta = useRef<Meta | null>(null);
  const attempt = useRef(0);

  const load = useCallback(async (requested: string | null) => {
    const current = ++attempt.current;
    try {
      meta.current ??= (await request<{ data: Meta }>("/meta")).data;
      const { scenarios, default_scenario: fallback, demo_notice: demoNotice } = meta.current;
      const keys = scenarios.map((s) => s.key);
      const scenario = requested && keys.includes(requested) ? requested : readScenario(browserStorage(), keys, fallback);
      writeScenario(browserStorage(), scenario);
      const opened = await openWorkspace(scenario);
      if (current === attempt.current) setState({ status: "ready", scenario, scenarios, demoNotice, ...opened });
    } catch (error) {
      if (current === attempt.current) setState({ status: "error", error: asApiError(error) });
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const retry = useCallback(() => {
    setState({ status: "loading", message: "Tentando novamente" });
    void load(null);
  }, [load]);

  const switchScenario = useCallback(
    (scenario: string) => {
      const label = meta.current?.scenarios.find((s) => s.key === scenario)?.label ?? scenario;
      setState({ status: "loading", message: `Abrindo o cenário ${label}` });
      void load(scenario);
    },
    [load],
  );

  return <WorkspaceContext.Provider value={{ state, retry, switchScenario }}>{children}</WorkspaceContext.Provider>;
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
