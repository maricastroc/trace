"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { API_URL } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { AREAS, isCurrentArea } from "./areas";
import { Brand } from "./Brand";
import { ScenarioMenu } from "./ScenarioMenu";
import { SyntheticNotice } from "./SyntheticNotice";
import { Trail, TrailProvider } from "./Trail";

function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Áreas do Trace" className="flex gap-1.5 max-[900px]:col-span-2 max-[900px]:-mx-4 max-[900px]:items-center max-[900px]:overflow-x-auto max-[900px]:border-t max-[900px]:border-rule max-[900px]:px-4">
      {AREAS.map((area) => (
        <Link key={area.href} href={area.href} className="nav-link" aria-current={isCurrentArea(pathname, area.href) ? "page" : undefined}>
          {area.label}
        </Link>
      ))}
    </nav>
  );
}

function Header() {
  const { state, switchScenario } = useWorkspace();
  const ready = state.status === "ready" ? state : null;
  return (
    <header className="relative z-20 flex h-(--bar-h) items-center gap-5 border-b border-rule bg-paper px-5 max-[900px]:grid max-[900px]:grid-cols-[auto_minmax(0,1fr)] max-[900px]:grid-rows-[56px_44px] max-[900px]:gap-x-3 max-[900px]:gap-y-0 max-[900px]:px-4">
      <Brand />
      <div className="flex min-w-0 items-center gap-2.5 border-l border-rule pl-4 max-[900px]:pl-3">
        <ScenarioMenu current={ready?.scenario ?? null} scenarios={ready?.scenarios ?? []} busy={state.status === "loading"} onSelect={switchScenario} />
        {ready?.workspace.scenario && <SyntheticNotice notice={ready.demoNotice} />}
      </div>
      <MainNav />
    </header>
  );
}

function Loading({ message }: { message: string }) {
  return (
    <div role="status" className="mx-auto flex max-w-[1240px] items-center gap-3 px-8 py-24 text-[19px] text-ink-2">
      <span aria-hidden className="inline-block size-2.5 animate-pulse rounded-full bg-ab" />
      {message}…
    </div>
  );
}

function Failure() {
  const { state, retry } = useWorkspace();
  if (state.status !== "error") return null;
  return (
    <div role="alert" className="mx-auto max-w-[760px] px-8 py-20">
      <p className="eyebrow eyebrow-b">Sem conexão com o backend</p>
      <h1 className="mt-3 font-display text-[44px] leading-[1.02] font-bold tracking-[-0.03em]">O Trace não conseguiu falar com a API.</h1>
      <p className="mt-4 text-[17px] leading-relaxed text-ink-2">{state.error.message}</p>
      {state.error.isUnreachable && (
        <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
          Inicie o Laravel em <code className="font-mono">backend/</code> e confirme que ele responde em <code className="font-mono">{API_URL}</code>.
        </p>
      )}
      <button type="button" onClick={retry} className="btn btn-primary mt-6">
        Tentar novamente
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { state } = useWorkspace();
  return (
    <TrailProvider>
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>
      <div className="sticky top-0 z-30">
        <Header />
        <Trail />
      </div>
      <main id="conteudo" tabIndex={-1} className="relative outline-none">
        {state.status === "loading" && <Loading message={state.message} />}
        {state.status === "error" && <Failure />}
        {state.status === "ready" && <div key={state.token}>{children}</div>}
      </main>
    </TrailProvider>
  );
}
