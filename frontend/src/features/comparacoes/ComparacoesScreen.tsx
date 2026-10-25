"use client";

import { useTrail } from "@/components/shell/Trail";
import { UnderConstruction } from "@/features/shared/UnderConstruction";

export function ComparacoesScreen() {
  useTrail([{ label: "Comparações" }]);

  return (
    <div className="mx-auto grid max-w-[1240px] gap-10 px-8 pt-9 pb-24">
      <header className="grid gap-2">
        <p className="eyebrow eyebrow-ab">Comparações</p>
        <h1 className="font-display text-[clamp(30px,3.2vw,44px)] leading-[1.08] font-bold tracking-[-0.03em]">Por que esses números não batem?</h1>
        <UnderConstruction>
          O backend ainda não tem o módulo de comparações. Ele será criado com o contrato matemático da reconciliação e testes próprios antes desta tela mostrar qualquer número.
        </UnderConstruction>
      </header>
    </div>
  );
}
