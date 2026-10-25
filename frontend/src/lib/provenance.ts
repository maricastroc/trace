import type { RunDetail, RunStatus } from "./types";

export type InputBasis = {
  position: number;
  alias: string;
  datasetId: string;
  datasetName: string;
  versionId: string;
  versionNumber: number;
  rows: number | null;
  newerVersionAvailable: boolean;
};

export type DecisionBasis = {
  stepPosition: number;
  relationshipId: string;
  joinType: "inner" | "left";
};

export type Basis = {
  recipe: { id: string; revision: number } | null;
  inputs: InputBasis[];
  decisions: DecisionBasis[];
};

export type PreviewProvenance = {
  kind: "preview";
  traceable: false;
  basis: Basis;
  computedAt: string;
};

export type RunProvenance = {
  kind: "run";
  traceable: true;
  runId: string;
  status: RunStatus;
  basis: Basis;
  finishedAt: string | null;
  recipeChangedSince: boolean;
};

export type Provenance = PreviewProvenance | RunProvenance;

export type InvestigationLayer = "entender" | "explorar" | "auditar";

export const LAYER_ENDPOINTS: Record<InvestigationLayer, readonly string[]> = {
  entender: ["runs/{run}", "runs/{run}/results", "runs/{run}/flows"],
  explorar: ["runs/{run}/flow", "runs/{run}/results/{result}", "runs/{run}/results/{result}/breakdown"],
  auditar: [
    "runs/{run}/results/{result}/contributors",
    "runs/{run}/exclusions",
    "runs/{run}/diagnostics",
    "runs/{run}/rows",
    "runs/{run}/rows/{row}/journey",
    "dataset-versions/{version}/rows",
  ],
};

export function runProvenance(run: RunDetail): RunProvenance {
  return {
    kind: "run",
    traceable: true,
    runId: run.id,
    status: run.status,
    finishedAt: run.finished_at,
    recipeChangedSince: run.recipe_changed_since,
    basis: {
      recipe: { id: run.recipe.id, revision: run.recipe.revision },
      inputs: run.inputs.map((input) => ({
        position: input.position,
        alias: input.alias,
        datasetId: input.dataset_id,
        datasetName: input.dataset_name,
        versionId: input.version_id,
        versionNumber: input.version_number,
        rows: input.row_count,
        newerVersionAvailable: input.newer_version_available,
      })),
      decisions: run.steps.flatMap((step) =>
        step.join ? [{ stepPosition: step.position, relationshipId: step.join.relationship_id, joinType: step.join.join_type }] : [],
      ),
    },
  };
}

function inputKey(basis: Basis) {
  return [...basis.inputs]
    .sort((a, b) => a.position - b.position)
    .map((input) => `${input.position}:${input.versionId}`)
    .join("|");
}

function decisionKey(basis: Basis) {
  return [...basis.decisions]
    .sort((a, b) => a.stepPosition - b.stepPosition)
    .map((decision) => `${decision.stepPosition}:${decision.relationshipId}:${decision.joinType}`)
    .join("|");
}

export function sameBasis(a: Basis, b: Basis) {
  const sameRecipe = a.recipe === null || b.recipe === null ? a.recipe === b.recipe : a.recipe.id === b.recipe.id && a.recipe.revision === b.recipe.revision;
  return sameRecipe && inputKey(a) === inputKey(b) && decisionKey(a) === decisionKey(b);
}

export function isAuditable(provenance: Provenance): provenance is RunProvenance {
  return provenance.kind === "run" && provenance.status === "succeeded";
}

export function staleness(provenance: Provenance) {
  const newerInputs = provenance.basis.inputs.filter((input) => input.newerVersionAvailable).map((input) => input.alias);
  return {
    newerInputs,
    recipeChanged: provenance.kind === "run" && provenance.recipeChangedSince,
    current: newerInputs.length === 0 && !(provenance.kind === "run" && provenance.recipeChangedSince),
  };
}
