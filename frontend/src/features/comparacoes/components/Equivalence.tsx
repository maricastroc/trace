"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { formatCount, formatPercent } from "@/lib/format";
import { useRelationships } from "@/lib/queries";
import type { ComparisonEquivalence, EquivalenceDeclaration } from "@/lib/types";
import { column, type Catalog } from "@/features/perguntas/model/catalog";
import { declarationFor, equivalenceOf, type Pair } from "../model/spec";

const TYPE_WORD: Record<string, string> = { identifier: "identificador", number: "número", date: "data", text: "texto" };

function fieldName(catalog: Catalog, field: Pair["a"]) {
  return `${catalog.byId.get(field.table)?.key ?? "?"}.${field.key}`;
}

function Profile({ catalog, field }: { catalog: Catalog; field: Pair["a"] }) {
  const table = catalog.byId.get(field.table);
  const found = table ? column(table, field.key) : null;
  if (!found) return null;
  const samples = found.profile.samples.slice(0, 3);
  return (
    <li>
      <b className="mono">{fieldName(catalog, field)}</b>
      <span>
        {TYPE_WORD[found.type] ?? found.type} · {formatCount(found.profile.distinct)} valores diferentes
        {samples.length > 0 && (
          <>
            {" "}
            · ex.: <span className="mono">{samples.join(", ")}</span>
          </>
        )}
      </span>
    </li>
  );
}

type Props = { catalog: Catalog; pair: Pair | null; declaration: EquivalenceDeclaration | null; onChange: (declaration: EquivalenceDeclaration | null) => void };

export function EquivalenceCheck({ catalog, pair, declaration, onChange }: Props) {
  const ids = useId();
  const relationships = useRelationships();
  const state = equivalenceOf(catalog, pair, declaration);
  if (!pair || state.status === "incomplete") return null;

  const a = fieldName(catalog, pair.a);
  const b = fieldName(catalog, pair.b);
  const relation = state.relation;
  const route = relation
    ? `${fieldName(catalog, { table: relation.from.table, key: relation.from.column })} → ${fieldName(catalog, { table: relation.to.table, key: relation.to.column })}`
    : null;
  const evidence = relation ? relationships.data?.data.find((candidate) => candidate.id === relation.id)?.evidence : undefined;

  if (state.status === "same_field") {
    return (
      <p className="eq-line">
        <span className="eq-tag ok">mesma coluna</span>
        Os dois lados usam {a}. A correspondência vem da própria definição; não há o que confirmar.
      </p>
    );
  }

  if (state.status === "relation" && relation) {
    const from = fieldName(catalog, { table: relation.from.table, key: relation.from.column });
    const to = fieldName(catalog, { table: relation.to.table, key: relation.to.column });
    return (
      <p className="eq-line">
        <span className="eq-tag ok">referência confirmada no Mapa</span>A relação <span className="mono">{route}</span> foi confirmada no Mapa: cada valor de{" "}
        <span className="mono">{from}</span> aponta para um único registro pela coluna <span className="mono">{to}</span>, que não se repete. Os dois lados usam os mesmos
        identificadores.{" "}
        <Link className="btn-link" href={`/mapa?relacao=${relation.id}`}>
          Ver a evidência
        </Link>
      </p>
    );
  }

  const declared = state.status === "declared";
  return (
    <div className={`eq-box ${declared ? "done" : ""}`} role="group" aria-labelledby={`${ids}-t`}>
      <p className="eq-title" id={`${ids}-t`}>
        <span className={`eq-tag ${declared ? "user" : "warn"}`}>{declared ? "declarada por você" : "sem confirmação"}</span>
        Estas colunas identificam a mesma entidade?
      </p>
      <p className="eq-text">
        Você escolheu comparar <b className="mono">{pair.a.key}</b> com <b className="mono">{pair.b.key}</b>. Esses campos podem representar tipos diferentes de informação.
        Confirme que os valores identificam a mesma entidade antes de continuar.
      </p>
      <ul className="eq-evidence" aria-label="O que se sabe sobre as colunas">
        <li>
          {state.gap === "rejected" ? (
            <span>
              A relação <span className="mono">{route}</span> foi rejeitada no Mapa.
            </span>
          ) : state.gap === "suggested" ? (
            <span>
              A relação <span className="mono">{route}</span> do Mapa sugere estas colunas
              {evidence ? `: ${formatPercent(evidence.match.match_ratio)} das linhas de ${evidence.from.dataset_key} encontram o valor em ${evidence.to.dataset_key}` : ""}. Isso
              aproxima as colunas, mas não prova que identificam a mesma entidade. Se uma coluna de fato referencia a outra, confirmar a relação no Mapa permite ler a comparação
              como cadastro e referências.
            </span>
          ) : state.gap === "multiplicity" || state.gap === "target_repeats" ? (
            <span>
              A relação <span className="mono">{route}</span> está confirmada no Mapa, mas o destino tem valores repetidos: ela não identifica um registro único e não basta para
              dizer que as colunas identificam a mesma entidade.
            </span>
          ) : state.gap === "one_to_one" ? (
            <span>
              A relação <span className="mono">{route}</span> está confirmada no Mapa, mas a origem também não se repete: uma relação um para um pode ligar entidades diferentes.
            </span>
          ) : state.gap === "review" ? (
            <span>
              A relação <span className="mono">{route}</span> está em revisão no Mapa e, por enquanto, não basta como evidência.
            </span>
          ) : (
            <span>O Mapa não tem nenhuma relação entre estas duas colunas.</span>
          )}
          {relation && (
            <>
              {" "}
              <Link className="btn-link" href={`/mapa?relacao=${relation.id}`}>
                Ver a evidência
              </Link>
            </>
          )}
        </li>
        <Profile catalog={catalog} field={pair.a} />
        <Profile catalog={catalog} field={pair.b} />
      </ul>
      <label className="eq-confirm" htmlFor={`${ids}-c`}>
        <input id={`${ids}-c`} type="checkbox" checked={declared} onChange={(event) => onChange(event.target.checked ? declarationFor(pair) : null)} />
        <span>
          Confirmo que <span className="mono">{a}</span> e <span className="mono">{b}</span> identificam a mesma entidade nesta comparação.
        </span>
      </label>
      <p className="small-note">
        Vale só para estas duas colunas: se uma delas mudar, será preciso confirmar de novo. Na comparação rastreada, fica registrado que a equivalência foi declarada por você, não
        verificada pelo Trace.
      </p>
    </div>
  );
}

export function EquivalenceGate({
  catalog,
  equivalence,
  onConfirm,
  onEdit,
}: {
  catalog: Catalog;
  equivalence: ComparisonEquivalence;
  onConfirm: (declaration: EquivalenceDeclaration) => void;
  onEdit: () => void;
}) {
  const pair: Pair = { a: { table: equivalence.a.dataset_id, key: equivalence.a.key }, b: { table: equivalence.b.dataset_id, key: equivalence.b.key } };
  const [declaration, setDeclaration] = useState<EquivalenceDeclaration | null>(null);
  return (
    <section className="cmp-gate" aria-labelledby="cmp-gate-title">
      <p className="eyebrow eyebrow-ab">Comparação · antes de ver o resultado</p>
      <h1 id="cmp-gate-title">Confirme o que está sendo comparado</h1>
      <p className="cs-lede">{equivalence.statement}</p>
      <EquivalenceCheck catalog={catalog} pair={pair} declaration={declaration} onChange={setDeclaration} />
      <div className="cs-actions">
        <button type="button" className="btn btn-primary" disabled={!declaration} onClick={() => declaration && onConfirm(declaration)}>
          Comparar
        </button>
        <button type="button" className="btn btn-quiet" onClick={onEdit}>
          Editar os conjuntos
        </button>
      </div>
    </section>
  );
}
