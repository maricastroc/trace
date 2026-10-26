"use client";

import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { formatPercent } from "@/lib/format";
import { useDecideRelationship, useRelationships } from "@/lib/queries";
import type { Issue, Relationship } from "@/lib/types";

function route(relationship: Relationship | undefined) {
  return relationship ? `${relationship.from.dataset_key}.${relationship.from.column} → ${relationship.to.dataset_key}.${relationship.to.column}` : "relação";
}

function unique(issues: Issue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${String(issue.details.relationship_id ?? issue.details.alias ?? issue.message)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function Needs({ issues, id }: { issues: Issue[]; id?: string }) {
  const relationships = useRelationships();
  const decide = useDecideRelationship();
  const toast = useToast();
  const byId = new Map(relationships.data?.data.map((relationship) => [relationship.id, relationship]));
  const list = unique(issues);
  if (list.length === 0) return null;

  return (
    <div className="needs" id={id}>
      {list.map((issue) => {
        const relationshipId = typeof issue.details.relationship_id === "string" ? issue.details.relationship_id : null;
        const relationship = relationshipId ? byId.get(relationshipId) : undefined;
        const key = `${issue.code}:${relationshipId ?? issue.message}`;

        if (issue.code === "join.relationship_unconfirmed" && issue.details.target_unique === true && relationshipId) {
          return (
            <div key={key} className="need">
              <p>
                <b className="mono">{route(relationship)}</b>
                <span className="nd-why">
                  Ainda é uma sugestão.{relationship ? ` Cobertura de ${formatPercent(relationship.evidence.match.match_ratio)} e destino sem ids repetidos: a evidência sustenta N:1.` : ""}
                </span>
              </p>
              <div className="q-actions">
                <button
                  type="button"
                  className="btn btn-ab"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: relationshipId, action: "confirm" }, { onSuccess: () => toast(`Relação confirmada: ${route(relationship)}`) })}
                >
                  Confirmar relação
                </button>
                <Link className="btn btn-quiet" href={`/mapa?relacao=${relationshipId}`}>
                  Ver evidência no mapa
                </Link>
              </div>
              {decide.error && (
                <p role="alert" className="small-note text-b-deep">
                  {decide.error.message}
                </p>
              )}
            </div>
          );
        }

        if (issue.code.startsWith("join.") && relationshipId) {
          const why =
            issue.code === "join.relationship_unconfirmed"
              ? "O destino repete ids: confirmar exige decidir o que fazer com as linhas a mais. Decida no mapa, onde dá para ver o que multiplica."
              : issue.code === "join.relationship_rejected"
                ? "Você rejeitou esta relação, então a pergunta não pode atravessá-la. Reveja no mapa ou escolha outro recorte."
                : issue.message;
          return (
            <div key={key} className="need hard">
              <p>
                <b className="mono">{route(relationship)}</b>
                <span className="nd-why">{why}</span>
              </p>
              <div className="q-actions">
                <Link className="btn btn-ab" href={`/mapa?relacao=${relationshipId}`}>
                  Decidir no mapa
                </Link>
              </div>
            </div>
          );
        }

        const alias = typeof issue.details.alias === "string" ? issue.details.alias : null;
        return (
          <div key={key} className={`need ${issue.code === "validity.undeclared" ? "" : "hard"}`}>
            <p>
              <b>{issue.code.startsWith("validity.") && alias ? `Vigência de ${alias}` : "Decisão pendente"}</b>
              <span className="nd-why">{issue.message}</span>
            </p>
            {alias && (
              <div className="q-actions">
                <Link className="btn" href={`/mapa?tabela=${alias}`}>
                  Abrir {alias} no mapa
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
