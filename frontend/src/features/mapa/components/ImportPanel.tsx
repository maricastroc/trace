"use client";

import { useId, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { formatCount, plural } from "@/lib/format";
import { useImportFile, useImportPreview, useMeta } from "@/lib/queries";
import type { ImportPreview } from "@/lib/types";
import type { MapModel } from "../model/graph";
import { TYPE_WORDS } from "./FieldIcon";

type Props = {
  model: MapModel;
  target: string | null;
  onDone: (key: string, id: string) => void;
  onCancel: () => void;
};

const DELIMITERS: Record<string, string> = { ",": "vírgula", ";": "ponto e vírgula", "\t": "tabulação", "|": "barra vertical" };

function baseName(filename: string) {
  return filename.replace(/\.(csv|tsv|txt)$/i, "");
}

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${formatCount(Math.max(1, Math.round(bytes / 1024)))} KB`;
  const mb = bytes / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1).replace(".", ",")} MB`;
}

function problemDetail(error: Error) {
  if (!(error instanceof ApiError)) return null;
  const details = error.details as { examples?: { line: number; expected: number; found: number }[]; total?: number; position?: number };
  if (error.code === "csv.ragged_rows" && details.examples?.length) {
    const lines = details.examples.map((example) => `linha ${example.line}: ${example.found} em vez de ${example.expected}`).join("; ");
    const more = (details.total ?? 0) > details.examples.length ? ` e mais ${formatCount((details.total ?? 0) - details.examples.length)}` : "";
    return `Colunas por linha (${lines}${more}).`;
  }
  if ((error.code === "csv.empty_header" || error.code === "csv.header_too_long") && details.position) return `Posição da coluna no cabeçalho: ${details.position}.`;
  return null;
}

function ImportError({ error }: { error: Error }) {
  const detail = problemDetail(error);
  return (
    <p role="alert" className="small-note mt-3 text-b-deep">
      {error.message}
      {detail && (
        <>
          <br />
          {detail}
        </>
      )}
    </p>
  );
}

export function ImportPanel({ model, target, onDone, onCancel }: Props) {
  const meta = useMeta();
  const preview = useImportPreview();
  const save = useImportFile();
  const toast = useToast();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<"new" | "version">(target ? "version" : "new");
  const [name, setName] = useState("");
  const [destination, setDestination] = useState(target ?? model.tables[0]?.key ?? "");
  const [tooLarge, setTooLarge] = useState<string | null>(null);

  const limits = meta.data?.data.limits;
  const enabled = meta.data?.data.uploads_enabled ?? true;
  const read = preview.data?.data ?? null;
  const existing = mode === "version" ? (model.byKey.get(destination) ?? null) : null;

  const choose = (chosen: File | null | undefined) => {
    if (!chosen) return;
    setFile(chosen);
    setName(baseName(chosen.name));
    save.reset();
    if (limits && chosen.size > limits.upload_kb * 1024) {
      preview.reset();
      setTooLarge(`O arquivo tem ${sizeLabel(chosen.size)}; esta instalação aceita até ${sizeLabel(limits.upload_kb * 1024)}. Divida o arquivo ou reduza as colunas antes de enviar.`);
      return;
    }
    setTooLarge(null);
    preview.mutate(chosen);
  };

  const submit = () => {
    if (!file || !read) return;
    save.mutate(
      mode === "version" && existing ? { file, datasetId: existing.id } : { file, name: name.trim() || undefined },
      {
        onSuccess: (response) => {
          const key = response.data.key;
          toast(mode === "version" ? `Nova versão de ${key}: ${plural(read.row_count, "linha", "linhas")}. Procurando relações…` : `${key} importada: ${plural(read.row_count, "linha", "linhas")}. Procurando relações…`);
          onDone(key, response.data.id);
        },
      },
    );
  };

  if (!enabled) {
    return <p className="small-note">O envio de arquivos está desativado nesta instalação. Explore os cenários de demonstração.</p>;
  }

  return (
    <>
      <section className="panel-section">
        <h3>Arquivo</h3>
        <label
          htmlFor={inputId}
          className={`import-drop ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            choose(event.dataTransfer.files[0]);
          }}
        >
          <b>{file ? file.name : "Escolha um arquivo ou arraste até aqui"}</b>
          <span>
            .csv, .tsv ou .txt, com os nomes das colunas na primeira linha
            {limits ? ` · até ${sizeLabel(limits.upload_kb * 1024)} e ${formatCount(limits.rows)} linhas` : ""}
          </span>
          <span className="btn import-pick" aria-hidden>
            {file ? "Trocar arquivo" : "Escolher arquivo"}
          </span>
        </label>
        <input id={inputId} type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(event) => choose(event.target.files?.[0])} />
        {preview.isPending && (
          <p role="status" className="small-note mt-3">
            Lendo o arquivo…
          </p>
        )}
        {tooLarge && (
          <p role="alert" className="small-note mt-3 text-b-deep">
            {tooLarge}
          </p>
        )}
        {preview.error && <ImportError error={preview.error} />}
      </section>

      {read && <ReadSummary read={read} />}

      {read && (
        <section className="panel-section">
          <h3>Destino</h3>
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="sr-only">Para onde vai o arquivo</legend>
            <label className="flex items-center gap-2 text-[15px]">
              <input type="radio" name="import-mode" checked={mode === "new"} onChange={() => setMode("new")} />
              Nova tabela
            </label>
            <label className="flex items-center gap-2 text-[15px]">
              <input type="radio" name="import-mode" checked={mode === "version"} onChange={() => setMode("version")} disabled={model.tables.length === 0} />
              Nova versão de uma tabela que já existe
            </label>
          </fieldset>
          {mode === "new" ? (
            <label className="mt-3 grid gap-1">
              <span className="eyebrow">nome</span>
              <input className="import-input" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
              <span className="small-note">
                A chave da tabela será <b className="font-mono">{read.suggested_key}</b>
                {model.byKey.has(read.suggested_key) ? " com um número no fim, porque essa chave já existe" : ""}.
              </span>
            </label>
          ) : (
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1">
                <span className="eyebrow">tabela</span>
                <select className="select" value={destination} onChange={(event) => setDestination(event.target.value)}>
                  {model.tables.map((table) => (
                    <option key={table.key} value={table.key}>
                      {table.key} · versão {table.versionNumber}
                    </option>
                  ))}
                </select>
              </label>
              {existing && <VersionDiff before={existing.columns.map((c) => c.key)} after={read.columns.map((c) => c.key)} table={existing.key} next={existing.versionNumber + 1} />}
            </div>
          )}
          {save.error && <ImportError error={save.error} />}
          <div className="panel-actions mt-4">
            <button type="button" className="btn btn-ab" disabled={save.isPending || (mode === "version" && !existing)} onClick={submit}>
              {save.isPending ? "Importando…" : mode === "version" ? "Importar nova versão" : "Importar tabela"}
            </button>
            <button type="button" className="btn btn-quiet" disabled={save.isPending} onClick={onCancel}>
              Cancelar
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function ReadSummary({ read }: { read: ImportPreview }) {
  const shownColumns = read.columns.map((column) => column.key);
  return (
    <>
      <section className="panel-section">
        <h3>O que o Trace leu</h3>
        <p className="m-0 text-[15px] leading-relaxed">
          {plural(read.row_count, "linha", "linhas")} e {plural(read.column_count, "coluna", "colunas")}, {sizeLabel(read.size_bytes)}. Codificação {read.encoding}, separador{" "}
          {DELIMITERS[read.delimiter] ?? `“${read.delimiter}”`}.
        </p>
        {read.warnings.length > 0 && (
          <ul className="import-warnings">
            {read.warnings.map((warning) => (
              <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel-section">
        <h3>Colunas · tipo inferido</h3>
        <div className="rt-wrap">
          <div className="rt-scroll">
            <table className="rt" aria-label="Colunas lidas do arquivo">
              <thead>
                <tr>
                  <th scope="col">coluna</th>
                  <th scope="col">tipo</th>
                  <th scope="col">vazios</th>
                  <th scope="col">diferentes</th>
                  <th scope="col">exemplos</th>
                </tr>
              </thead>
              <tbody>
                {read.columns.map((column) => (
                  <tr key={column.key}>
                    <td>{column.key}</td>
                    <td title={column.profile.type_reason}>{TYPE_WORDS[column.type] ?? column.type}</td>
                    <td>{formatCount(column.profile.nulls)}</td>
                    <td>{formatCount(column.profile.distinct)}</td>
                    <td className="empty">{column.profile.samples.slice(0, 3).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="small-note mt-2">O tipo é só uma leitura: nada é convertido. Valores como 0187 continuam exatamente como estão no arquivo.</p>
      </section>
      <section className="panel-section">
        <h3>Primeiras linhas</h3>
        <div className="rt-wrap">
          <div className="rt-scroll">
            <table className="rt" aria-label="Primeiras linhas do arquivo">
              <thead>
                <tr>
                  <th scope="col">linha</th>
                  {shownColumns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {read.rows.slice(0, 8).map((row) => (
                  <tr key={row.line_number}>
                    <td>{row.line_number}</td>
                    {shownColumns.map((column) => {
                      const value = row.values[column];
                      return (
                        <td key={column} className={value === null ? "empty" : undefined}>
                          {value ?? "vazio"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

function VersionDiff({ before, after, table, next }: { before: string[]; after: string[]; table: string; next: number }) {
  const added = after.filter((key) => !before.includes(key));
  const removed = before.filter((key) => !after.includes(key));
  return (
    <div className="grid gap-1 text-[14.5px] leading-relaxed">
      <p className="m-0">
        Vira a versão {next} de <b className="font-mono">{table}</b>. A versão atual continua guardada, e as execuções antigas seguem apontando para ela.
      </p>
      {added.length === 0 && removed.length === 0 ? (
        <p className="small-note">Mesmas colunas da versão atual.</p>
      ) : (
        <>
          {added.length > 0 && <p className="small-note">Colunas novas: {added.join(", ")}.</p>}
          {removed.length > 0 && (
            <p className="small-note text-b-deep">Colunas que deixam de existir: {removed.join(", ")}. Relações e perguntas que usam essas colunas vão pedir revisão.</p>
          )}
        </>
      )}
    </div>
  );
}
