import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  FileImage,
  FolderOpen,
  FolderTree,
  Layers3,
  LoaderCircle,
  Microscope,
  Play,
  RefreshCw,
  Redo2,
  Search,
  Settings2,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import {
  batchCsvUrl,
  batchHistogramUrl,
  createBatch,
  createSession,
  edit,
  exportUrl,
  getBatch,
  getResult,
  redo,
  reprocess,
  sessionHistogramUrl,
  subscribeJob,
  undo,
} from "./api";
import { ImageViewer } from "./components/ImageViewer";
import { BatchSummary } from "./components/BatchSummary";
import { SessionHistogram } from "./components/SessionHistogram";
import { MetricsPanel } from "./components/MetricsPanel";
import { NucleiTable } from "./components/NucleiTable";
import type { Batch, BatchPair, Config, Job, Result } from "./types";

const defaults: Config = {
  nucleus_channel: 0,
  protein_channel: 2,
  gaussian_kernel: 5,
  gaussian_sigma: 1,
  opening_kernel: 3,
  closing_kernel: 5,
  min_nucleus_area: 100,
  background_border_width: 20,
  pixel_size: null,
  pixel_unit: "µm",
  input_mode: "auto",
};
type InputMode = "single" | "folders";
const imageExtensions = /\.(tif|tiff|png|jpe?g)$/i;
function imageFiles(files: FileList | null): File[] {
  return Array.from(files ?? []).filter((file) =>
    imageExtensions.test(file.name),
  );
}
function folderLabel(files: File[]): string {
  if (!files.length) return "Nenhuma pasta selecionada";
  const relative = files[0].webkitRelativePath || files[0].name;
  return relative.split(/[\\/]/)[0] || `${files.length} imagens`;
}

export default function App() {
  const [mode, setMode] = useState<InputMode>("single");
  const [nucleusFile, setNucleusFile] = useState<File>();
  const [proteinFile, setProteinFile] = useState<File>();
  const [nucleusFolder, setNucleusFolder] = useState<File[]>([]);
  const [proteinFolder, setProteinFolder] = useState<File[]>([]);
  const [config, setConfig] = useState<Config>(defaults);
  const [result, setResult] = useState<Result>();
  const [job, setJob] = useState<Job>();
  const [batch, setBatch] = useState<Batch>();
  const [selected, setSelected] = useState<number[]>([]);
  const [layer, setLayer] = useState<"nucleus" | "protein" | "mask">("protein");
  const [labels, setLabels] = useState(true);
  const [editId, setEditId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<"adjust" | "redraw">("adjust");
  const [redrawVersion, setRedrawVersion] = useState(0);
  const [editPolygon, setEditPolygon] = useState<[number, number][] | null>(
    null,
  );
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [showHistogram, setShowHistogram] = useState(false);
  const selectedNucleus = result?.nuclei.find(
    (nucleus) => nucleus.nucleus_id === selected[0],
  );
  const visibleNuclei = useMemo(
    () =>
      (result?.nuclei ?? []).filter(
        (nucleus) => !filter || String(nucleus.nucleus_id).includes(filter),
      ),
    [result, filter],
  );
  const busy =
    job?.status === "queued" ||
    job?.status === "running" ||
    batch?.status === "queued" ||
    batch?.status === "running";

  useEffect(() => {
    if (!batch || ["completed", "error"].includes(batch.status)) return;
    const timer = window.setInterval(() => {
      void getBatch(batch.batch_id)
        .then((next) => {
          setBatch(next);
          const firstReady = next.pairs.find(
            (pair) => pair.status === "ready" && pair.session_id,
          );
          if (firstReady && !result) void loadPair(firstReady);
        })
        .catch(() => undefined);
    }, 900);
    return () => window.clearInterval(timer);
  }, [batch?.batch_id, batch?.status, result]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        void historyAction(undo);
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        void historyAction(redo);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  async function openSingle() {
    if (!nucleusFile || !proteinFile) {
      setError("Selecione os dois arquivos da amostra.");
      return;
    }
    try {
      setError("");
      setBatch(undefined);
      setResult(undefined);
      setShowHistogram(false);
      const session = await createSession(nucleusFile, proteinFile, config);
      setJob({
        job_id: session.job_id,
        session_id: session.session_id,
        status: session.status,
        progress: 0,
        message: "Aguardando processamento",
        error: null,
      });
      subscribeJob(
        session.session_id,
        setJob,
        () => void refresh(session.session_id),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao abrir a amostra",
      );
    }
  }
  async function openFolders() {
    if (!nucleusFolder.length || !proteinFolder.length) {
      setError("Selecione uma pasta de núcleos e uma pasta de proteínas.");
      return;
    }
    try {
      setError("");
      setResult(undefined);
      const next = await createBatch(nucleusFolder, proteinFolder, config);
      setBatch(next);
      setJob(undefined);
      const firstReady = next.pairs.find(
        (pair) => pair.status === "ready" && pair.session_id,
      );
      if (firstReady) await loadPair(firstReady);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao processar as pastas",
      );
    }
  }
  async function loadPair(pair: BatchPair) {
    if (!pair.session_id) return;
    try {
      setResult(await getResult(pair.session_id));
      setSelected([]);
      setEditId(null);
      setShowHistogram(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível abrir o par",
      );
    }
  }
  async function refresh(id = result?.session_id) {
    if (!id) return;
    try {
      setResult(await getResult(id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao atualizar a amostra",
      );
    }
  }
  async function apply(operation: "hide" | "exclude" | "restore") {
    if (!result || !selected.length) return;
    try {
      setResult(
        await edit(result.session_id, {
          operation,
          nucleus_ids: selected,
          base_revision: result.revision,
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao aplicar a alteração",
      );
      await refresh();
    }
  }
  async function historyAction(action: typeof undo) {
    if (!result) return;
    try {
      setResult(await action(result.session_id, result.revision));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha no histórico");
    }
  }
  async function startReprocess() {
    if (
      !result ||
      !confirm(
        "Reprocessar descarta os identificadores e as edições atuais. Continuar?",
      )
    )
      return;
    try {
      const next = await reprocess(result.session_id, result.revision, config);
      setJob(next);
      subscribeJob(result.session_id, setJob, () => void refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao reprocessar");
    }
  }
  async function saveContour() {
    if (!result || !editId || !editPolygon) return;
    if (editPolygon.length < 3) {
      setError("Redesenhe o contorno com pelo menos três pontos antes de confirmar.");
      return;
    }
    try {
      setResult(
        await edit(result.session_id, {
          operation: "edit_contour",
          nucleus_id: editId,
          nucleus_ids: [editId],
          polygon: editPolygon,
          base_revision: result.revision,
        }),
      );
      setEditId(null);
      setEditPolygon(null);
      setEditMode("adjust");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Contorno inválido");
    }
  }

  const batchReady =
    batch?.pairs.filter((pair) => pair.status === "ready").length ?? 0;
  return (
    <div className="lab-shell">
      <header className="lab-header">
        <div className="institution-mark">
          <Microscope size={23} strokeWidth={1.7} />
        </div>
        <div className="identity">
          <span className="kicker">LABORATÓRIO DE MICROSCOPIA</span>
          <strong>Nuclei Review</strong>
          <span>Caracterização morfológica · Drosophila melanogaster</span>
        </div>
        <div className="header-meta">
          <span className="connection-dot" /> <span>Ambiente local</span>
          <span className="header-divider" />
          <span>Protocolo NR-01</span>
        </div>
      </header>
      <div className="lab-layout">
        <aside className="control-rail">
          <div className="rail-heading">
            <span className="section-label">WORKFLOW</span>
            <span className="version-tag">v0.1</span>
          </div>
          <div className="workflow-steps">
            <div className="workflow-step active">
              <span>01</span>
              <div>
                <strong>Aquisição</strong>
                <small>Arquivos e canais</small>
              </div>
            </div>
            <div className={`workflow-step ${result || batch ? "active" : ""}`}>
              <span>02</span>
              <div>
                <strong>Revisão</strong>
                <small>Máscaras e contornos</small>
              </div>
            </div>
            <div className="workflow-step">
              <span>03</span>
              <div>
                <strong>Exportação</strong>
                <small>Dados e relatório</small>
              </div>
            </div>
          </div>
          <section className="control-section import-section">
            <div className="section-title">
              <span>
                <FolderTree size={15} /> Fonte de dados
              </span>
              <span className="required">OBRIGATÓRIO</span>
            </div>
            <div className="input-tabs">
              <button
                className={mode === "single" ? "selected" : ""}
                onClick={() => setMode("single")}
              >
                <FileImage size={14} /> Amostra
              </button>
              <button
                className={mode === "folders" ? "selected" : ""}
                onClick={() => setMode("folders")}
              >
                <FolderOpen size={14} /> Pastas
              </button>
            </div>
            {mode === "single" ? (
              <div className="file-stack">
                <label className="file-field">
                  <span>Canal nuclear</span>
                  <input
                    type="file"
                    accept=".tif,.tiff,.png,.jpg,.jpeg"
                    onChange={(event) =>
                      setNucleusFile(event.target.files?.[0])
                    }
                  />
                  <span className="file-input-view">
                    {nucleusFile ? (
                      <>
                        <CheckCircle2 size={13} /> {nucleusFile.name}
                      </>
                    ) : (
                      <>
                        <FolderOpen size={13} /> Selecionar arquivo
                      </>
                    )}
                  </span>
                </label>
                <label className="file-field">
                  <span>Canal proteico</span>
                  <input
                    type="file"
                    accept=".tif,.tiff,.png,.jpg,.jpeg"
                    onChange={(event) =>
                      setProteinFile(event.target.files?.[0])
                    }
                  />
                  <span className="file-input-view">
                    {proteinFile ? (
                      <>
                        <CheckCircle2 size={13} /> {proteinFile.name}
                      </>
                    ) : (
                      <>
                        <FolderOpen size={13} /> Selecionar arquivo
                      </>
                    )}
                  </span>
                </label>
                <button
                  className="primary action-button"
                  onClick={() => void openSingle()}
                  disabled={busy}
                >
                  <Play size={14} /> Processar amostra
                </button>
              </div>
            ) : (
              <div className="folder-stack">
                <label className="folder-drop">
                  <input
                    type="file"
                    multiple
                    {...({ webkitdirectory: "", directory: "" } as Record<
                      string,
                      string
                    >)}
                    onChange={(event) =>
                      setNucleusFolder(imageFiles(event.target.files))
                    }
                  />
                  <FolderOpen size={20} />
                  <strong>{folderLabel(nucleusFolder)}</strong>
                  <span>
                    {nucleusFolder.length
                      ? `${nucleusFolder.length} imagens · núcleos`
                      : "Selecionar pasta de núcleos"}
                  </span>
                </label>
                <label className="folder-drop">
                  <input
                    type="file"
                    multiple
                    {...({ webkitdirectory: "", directory: "" } as Record<
                      string,
                      string
                    >)}
                    onChange={(event) =>
                      setProteinFolder(imageFiles(event.target.files))
                    }
                  />
                  <FolderOpen size={20} />
                  <strong>{folderLabel(proteinFolder)}</strong>
                  <span>
                    {proteinFolder.length
                      ? `${proteinFolder.length} imagens · proteínas`
                      : "Selecionar pasta de proteínas"}
                  </span>
                </label>
                <button
                  className="primary action-button"
                  onClick={() => void openFolders()}
                  disabled={busy}
                >
                  <Play size={14} /> Processar pastas
                </button>
                <p className="helper-text">
                  <Database size={13} /> Os pares são reconhecidos pelo nome
                  normalizado, não pela ordem dos arquivos.
                </p>
              </div>
            )}
          </section>
          <section className="control-section">
            <div className="section-title">
              <span>
                <SlidersHorizontal size={15} /> Configuração da aquisição
              </span>
            </div>
            <div className="field-grid">
              <label>
                Canal núcleos
                <input
                  type="number"
                  min="0"
                  value={config.nucleus_channel}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      nucleus_channel: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Canal proteína
                <input
                  type="number"
                  min="0"
                  value={config.protein_channel}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      protein_channel: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <div className="field-grid">
              <label>
                Pixel (µm)
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="opcional"
                  value={config.pixel_size ?? ""}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      pixel_size: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </label>
              <label>
                Entrada
                <select
                  value={config.input_mode}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      input_mode: event.target.value as Config["input_mode"],
                    })
                  }
                >
                  <option value="auto">Automática</option>
                  <option value="raw">Bruta</option>
                  <option value="derived">Derivada</option>
                </select>
              </label>
            </div>
          </section>
          <section className="control-section">
            <div className="section-title">
              <span>
                <Settings2 size={15} /> Segmentação
              </span>
            </div>
            <label>
              Área mínima do núcleo
              <input
                type="number"
                min="1"
                value={config.min_nucleus_area}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    min_nucleus_area: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Faixa de fundo
              <input
                type="number"
                min="1"
                value={config.background_border_width}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    background_border_width: Number(event.target.value),
                  })
                }
              />
            </label>
          </section>
          {batch && (
            <section className="batch-section">
              <div className="section-title">
                <span>
                  <Layers3 size={15} /> Lote em análise
                </span>
                <span className="batch-progress-text">{batch.progress}%</span>
              </div>
              <div className="batch-progress">
                <span style={{ width: `${batch.progress}%` }} />
              </div>
              <div className="batch-counts">
                <span>
                  {batchReady}/{batch.total} concluídos
                </span>
                <span>{batch.failed} pendentes/erro</span>
              </div>
              <div className="batch-list">
                {batch.pairs.map((pair) => (
                  <button
                    key={pair.key}
                    className={`batch-item ${pair.session_id === result?.session_id ? "selected" : ""}`}
                    disabled={!pair.session_id || pair.status === "error"}
                    onClick={() => void loadPair(pair)}
                  >
                    <span className={`pair-status ${pair.status}`} />
                    <span className="pair-name">
                      {pair.key.split(/[\\/]/).pop()}
                    </span>
                    <ChevronRight size={13} />
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>
        <main className="analysis-main">
          <div className="analysis-heading">
            <div>
              <span className="section-label">ESTAÇÃO DE ANÁLISE</span>
              <h1>
                {result
                  ? "Revisão de imagem"
                  : mode === "folders"
                    ? "Processamento em lote"
                    : "Aguardando aquisição"}
              </h1>
              <p>
                {result
                  ? `Quantificação e revisão manual · versão ${result.revision}`
                  : "Selecione arquivos ou pastas para iniciar o protocolo."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                onClick={() =>
                  result &&
                  window.open(exportUrl(result.session_id, "json"), "_blank")
                }
                disabled={!result}
              >
                <Download size={14} /> JSON
              </button>
              <button
                onClick={() =>
                  result &&
                  window.open(exportUrl(result.session_id, "csv"), "_blank")
                }
                disabled={!result}
              >
                CSV
              </button>
              <button
                onClick={() => setShowHistogram((current) => !current)}
                disabled={!result}
              >
                {showHistogram ? "Ocultar hist." : "Histograma"}
              </button>
              <button
                onClick={() => void startReprocess()}
                disabled={!result || busy}
              >
                <RefreshCw size={14} /> Reprocessar
              </button>
            </div>
          </div>
          {(job && busy) || (batch && busy) ? (
            <div className="processing-strip">
              <LoaderCircle size={15} className="spin" />
              <div>
                <strong>
                  {batch ? "Processamento em lote" : job?.message}
                </strong>
                <span>
                  {batch
                    ? `${batch.completed} de ${batch.total} pares concluídos`
                    : "O algoritmo está processando os canais originais."}
                </span>
              </div>
              <b>{batch?.progress ?? job?.progress ?? 0}%</b>
            </div>
          ) : null}
          {batch ? (
            <BatchSummary
              batch={batch}
              histogramUrl={(kind) => batchHistogramUrl(batch.batch_id, kind)}
              csvUrl={batchCsvUrl(batch.batch_id)}
            />
          ) : null}
          {result && !batch && showHistogram ? (
            <SessionHistogram
              result={result}
              histogramUrl={(kind) => sessionHistogramUrl(result.session_id, kind)}
            />
          ) : null}
          <div className="analysis-grid">
            <section className="image-panel">
              <div className="image-panel-header">
                <div>
                  <span className="section-label">VISUALIZAÇÃO</span>
                  <strong>
                    {layer === "protein"
                      ? "Canal proteico"
                      : layer === "nucleus"
                        ? "Canal nuclear"
                        : "Máscara segmentada"}
                  </strong>
                </div>
                <div className="layer-switcher">
                  {(["nucleus", "protein", "mask"] as const).map((item) => (
                    <button
                      key={item}
                      className={layer === item ? "active" : ""}
                      onClick={() => setLayer(item)}
                      disabled={!result}
                    >
                      {item === "nucleus"
                        ? "Núcleos"
                        : item === "protein"
                          ? "Proteína"
                          : "Máscara"}
                    </button>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={labels}
                      onChange={(event) => setLabels(event.target.checked)}
                    />{" "}
                    IDs
                  </label>
                </div>
              </div>
              <ImageViewer
                sessionId={result?.session_id ?? null}
                shape={result?.shape ?? null}
                nuclei={result?.nuclei ?? []}
                selected={selected}
                layer={layer}
                labels={labels}
                editId={editId}
                editMode={editMode}
                redrawVersion={redrawVersion}
                onSelect={(id, multi) =>
                  setSelected(
                    multi
                      ? selected.includes(id)
                        ? selected.filter((value) => value !== id)
                        : [...selected, id]
                      : [id],
                  )
                }
                onEditChange={setEditPolygon}
              />
            </section>
            <div className="review-sidebar">
              <MetricsPanel
                nucleus={selectedNucleus}
                aggregate={result?.aggregate}
                revision={result?.revision ?? 0}
                onAction={(operation) => void apply(operation)}
                editing={editId !== null}
                editMode={editMode}
                onEdit={() => {
                  if (!selectedNucleus) return;
                  setEditMode("adjust");
                  setEditId(selectedNucleus.nucleus_id);
                }}
                onRedraw={() => {
                  if (!selectedNucleus) return;
                  setEditMode("redraw");
                  setEditId(selectedNucleus.nucleus_id);
                  setRedrawVersion((version) => version + 1);
                }}
                onRestartRedraw={() => setRedrawVersion((version) => version + 1)}
                onSave={() => void saveContour()}
                onCancel={() => {
                  setEditId(null);
                  setEditPolygon(null);
                  setEditMode("adjust");
                }}
              />
              <section className="table-panel table-panel-side">
                <div className="table-header">
                  <div>
                    <span className="section-label">NÚCLEOS IDENTIFICADOS</span>
                    <strong>
                      {result
                        ? `${result.aggregate.nucleus_count ?? 0} núcleos ativos`
                        : "Nenhum resultado carregado"}
                    </strong>
                  </div>
                  <div className="table-tools">
                    <label className="search-field">
                      <Search size={13} />
                      <input
                        placeholder="ID"
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                      />
                    </label>
                    <button
                      onClick={() => void historyAction(undo)}
                      disabled={!result}
                      title="Desfazer"
                    >
                      <Undo2 size={14} />
                    </button>
                    <button
                      onClick={() => void historyAction(redo)}
                      disabled={!result}
                      title="Refazer"
                    >
                      <Redo2 size={14} />
                    </button>
                  </div>
                </div>
                <NucleiTable
                  compact
                  nuclei={visibleNuclei}
                  selected={selected}
                  onSelect={(id, multi) =>
                    setSelected(multi ? [...new Set([...selected, id])] : [id])
                  }
                />
              </section>
            </div>
          </div>
        </main>
      </div>
      <footer className="lab-footer">
        <span>
          <span className="connection-dot" /> API local conectada
        </span>
      </footer>
      {result?.warnings.map((warning) => (
        <div className="toast warning" key={warning}>
          <AlertTriangle size={15} /> {warning}
        </div>
      ))}
      {error && (
        <button className="toast error" onClick={() => setError("")}>
          <AlertTriangle size={15} /> {error}
        </button>
      )}
    </div>
  );
}
