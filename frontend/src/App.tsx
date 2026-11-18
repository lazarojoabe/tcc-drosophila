import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  FileImage,
  FolderOpen,
  FolderTree,
  History,
  Layers3,
  LoaderCircle,
  Microscope,
  Play,
  RefreshCw,
  Redo2,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Undo2,
  X,
} from "lucide-react";
import {
  batchCsvUrl,
  batchPackageUrl,
  batchHistogramUrl,
  createBatch,
  createSession,
  edit,
  exportUrl,
  getBatch,
  getHistory,
  getResult,
  listSessions,
  redo,
  reprocess,
  saveSession,
  saveBatch,
  sessionHistogramUrl,
  subscribeJob,
  undo,
} from "./api";
import { ImageViewer } from "./components/ImageViewer";
import { BatchSummary } from "./components/BatchSummary";
import { SessionHistogram } from "./components/SessionHistogram";
import { MetricsPanel } from "./components/MetricsPanel";
import { NucleiTable } from "./components/NucleiTable";
import { AuditTrail } from "./components/AuditTrail";
import type {
  AuditEntry,
  Batch,
  BatchPair,
  Config,
  Job,
  Result,
  SavedSession,
  SelectionModifiers,
} from "./types";

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
type DialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm?: () => void;
};
type ScrollSnapshot = {
  windowX: number;
  windowY: number;
  elements: Array<{ element: HTMLElement; left: number; top: number }>;
};

function captureScroll(): ScrollSnapshot {
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    elements: Array.from(
      document.querySelectorAll<HTMLElement>(
        ".control-rail, .analysis-main, .panel.right, .table-wrap, .table-panel, .audit-trail",
      ),
    ).map((element) => ({
      element,
      left: element.scrollLeft,
      top: element.scrollTop,
    })),
  };
}
const imageExtensions = /\.(tif|tiff|png|jpe?g)$/i;
function imageFiles(files: FileList | null): File[] {
  return Array.from(files ?? []).filter((file) =>
    imageExtensions.test(file.name),
  );
}
type DirectoryEntry = {
  kind: "file" | "directory";
  name: string;
  getFile?: () => Promise<File>;
  values?: () => AsyncIterable<DirectoryEntry>;
};
type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<DirectoryEntry>;
};
async function readDirectory(handle: DirectoryEntry, files: File[]): Promise<void> {
  if (!handle.values) return;
  for await (const entry of handle.values()) {
    if (entry.kind === "file" && entry.getFile) {
      files.push(await entry.getFile());
    } else if (entry.kind === "directory") {
      await readDirectory(entry, files);
    }
  }
}
function folderLabel(files: File[], explicitName?: string): string {
  if (explicitName) return explicitName;
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
  const [nucleusFolderName, setNucleusFolderName] = useState("");
  const [proteinFolderName, setProteinFolderName] = useState("");
  const nucleusFolderInput = useRef<HTMLInputElement>(null);
  const proteinFolderInput = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<Config>(defaults);
  const [result, setResult] = useState<Result>();
  const [job, setJob] = useState<Job>();
  const [batch, setBatch] = useState<Batch>();
  const [selected, setSelected] = useState<number[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
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
  const [reviewer, setReviewer] = useState("");
  const [showHistory, setShowHistory] = useState(true);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const pendingScroll = useRef<ScrollSnapshot | null>(null);
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

  useLayoutEffect(() => {
    const snapshot = pendingScroll.current;
    if (!snapshot) return;
    window.scrollTo(snapshot.windowX, snapshot.windowY);
    snapshot.elements.forEach(({ element, left, top }) => {
      if (!element.isConnected) return;
      element.scrollLeft = left;
      element.scrollTop = top;
    });
    pendingScroll.current = null;
  }, [result]);

  function commitResult(next: Result) {
    pendingScroll.current = captureScroll();
    setResult(next);
  }

  function selectNucleus(
    id: number,
    modifiers: SelectionModifiers,
    items: typeof visibleNuclei = visibleNuclei,
  ) {
    const ids = items.map((nucleus) => nucleus.nucleus_id);
    setSelected((current) => {
      if (modifiers.range) {
        const anchor = selectionAnchor ?? current[0] ?? id;
        const anchorIndex = ids.indexOf(anchor);
        const targetIndex = ids.indexOf(id);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const start = Math.min(anchorIndex, targetIndex);
          const end = Math.max(anchorIndex, targetIndex);
          const range = ids.slice(start, end + 1);
          return modifiers.additive
            ? [...new Set([...current, ...range])]
            : range;
        }
      }
      if (modifiers.additive) {
        return current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id];
      }
      return [id];
    });
    setSelectionAnchor(id);
  }

  function selectAll(ids: number[]) {
    if (!ids.length) return;
    setSelected((current) => {
      const allSelected = ids.every((id) => current.includes(id));
      return allSelected
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])];
    });
    setSelectionAnchor(ids[0]);
  }

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
    void refreshSavedSessions();
  }, []);
  useEffect(() => {
    if (result?.session_id) void refreshSavedSessions();
  }, [result?.session_id, result?.revision]);
  useEffect(() => {
    if (!result?.session_id) {
      setAuditEntries([]);
      return;
    }
    void getHistory(result.session_id)
      .then(setAuditEntries)
      .catch(() => undefined);
  }, [result?.session_id, result?.revision]);
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
      setDialog({
        title: "Arquivos incompletos",
        message: "Selecione o canal nuclear e o canal proteico antes de processar a amostra.",
      });
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
      setDialog({
        title: "Pastas incompletas",
        message: "Selecione uma pasta de núcleos e outra de proteínas antes de iniciar o lote.",
      });
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
      setSelectionAnchor(null);
      setEditId(null);
      setShowHistogram(false);
      setShowHistory(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível abrir o par",
      );
    }
  }
  async function refreshSavedSessions() {
    try {
      setSavedSessions(await listSessions());
    } catch {
      // A lista é complementar; a análise atual continua disponível offline.
    }
  }
  async function loadSavedSession(session: SavedSession) {
    try {
      setError("");
      setBatch(undefined);
      setJob(undefined);
      setResult(await getResult(session.session_id));
      setSelected([]);
      setSelectionAnchor(null);
      setEditId(null);
      setShowHistogram(false);
      setShowHistory(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível reabrir a sessão");
    }
  }
  async function refresh(id = result?.session_id) {
    if (!id) return;
    try {
      commitResult(await getResult(id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao atualizar a amostra",
      );
    }
  }
  async function apply(operation: "hide" | "exclude" | "restore") {
    if (!result || !selected.length) return;
    const affectedIds = new Set(selected);
    try {
      commitResult(
        await edit(result.session_id, {
          operation,
          nucleus_ids: selected,
          base_revision: result.revision,
          reviewer,
        }),
      );
      if (operation === "exclude") {
        setSelected((current) =>
          current.filter((nucleusId) => !affectedIds.has(nucleusId)),
        );
        setSelectionAnchor(null);
      }
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
      commitResult(await action(result.session_id, result.revision, reviewer));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha no histórico");
    }
  }
  async function startReprocess() {
    if (!result) return;
    setDialog({
      title: "Reprocessar análise?",
      message: "O reprocessamento recalcula a segmentação e substitui os identificadores e edições atuais desta sessão.",
      confirmLabel: "Reprocessar",
      onConfirm: () => void confirmReprocess(),
    });
  }
  async function confirmReprocess() {
    if (!result) return;
    setDialog(null);
    try {
      const next = await reprocess(
        result.session_id,
        result.revision,
        config,
        reviewer,
      );
      setJob(next);
      subscribeJob(result.session_id, setJob, () => void refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao reprocessar");
    }
  }
  async function saveCurrentSession() {
    if (!result && !batch) return;
    try {
      setSaveMessage("");
      if (batch) {
        const savedBatch = await saveBatch(batch.batch_id, reviewer);
        setBatch(savedBatch);
        const link = document.createElement("a");
        link.href = batchPackageUrl(savedBatch.batch_id);
        link.download = `nuclei-batch-${savedBatch.batch_id}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setSaveMessage("Lote completo baixado");
        window.setTimeout(() => setSaveMessage(""), 2600);
        await refreshSavedSessions();
        return;
      }
      if (!result) return;
      const saved = await saveSession(result.session_id, reviewer);
      commitResult(saved);
      const link = document.createElement("a");
      link.href = exportUrl(saved.session_id, "zip");
      link.download = `nuclei-analysis-${saved.session_id}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setSaveMessage("Pacote baixado");
      window.setTimeout(() => setSaveMessage(""), 2600);
      await refreshSavedSessions();
    } catch (cause) {
      setDialog({
        title: "Não foi possível salvar",
        message: cause instanceof Error ? cause.message : "Falha ao gravar a análise no sistema de arquivos.",
      });
    }
  }

  function selectFolder(files: FileList | null, role: "nucleus" | "protein") {
    const allFiles = Array.from(files ?? []);
    const validFiles = imageFiles(files);
    if (allFiles.length && !validFiles.length) {
      setDialog({
        title: "Formato não reconhecido",
        message: "A pasta selecionada não contém TIFF, PNG ou JPEG compatível.",
      });
    }
    if (role === "nucleus") {
      setNucleusFolder(validFiles);
      setNucleusFolderName("");
    } else {
      setProteinFolder(validFiles);
      setProteinFolderName("");
    }
  }
  async function pickFolder(role: "nucleus" | "protein") {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      setDialog({
        title: "Seletor de pastas indisponível",
        message: "Para selecionar uma pasta sem enviar arquivos individualmente, abra a plataforma no Google Chrome ou Microsoft Edge atualizado.",
      });
      return;
    }
    try {
      const directory = await picker();
      const files: File[] = [];
      await readDirectory(directory, files);
      const validFiles = files.filter((file) => imageExtensions.test(file.name));
      if (!validFiles.length) {
        setDialog({
          title: "Pasta sem imagens compatíveis",
          message: "A pasta selecionada não contém TIFF, PNG ou JPEG compatível.",
        });
        return;
      }
      if (role === "nucleus") {
        setNucleusFolder(validFiles);
        setNucleusFolderName(directory.name);
      } else {
        setProteinFolder(validFiles);
        setProteinFolderName(directory.name);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setDialog({
        title: "Não foi possível ler a pasta",
        message: "O navegador não permitiu acessar os arquivos selecionados. Tente novamente.",
      });
    }
  }
  async function saveContour() {
    if (!result || !editId || !editPolygon) return;
    if (editPolygon.length < 3) {
      setError("Redesenhe o contorno com pelo menos três pontos antes de confirmar.");
      return;
    }
    try {
      commitResult(
        await edit(result.session_id, {
          operation: "edit_contour",
          nucleus_id: editId,
          nucleus_ids: [editId],
          polygon: editPolygon,
          base_revision: result.revision,
          reviewer,
        }),
      );
      setEditId(null);
      setEditPolygon(null);
      setEditMode("adjust");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Contorno inválido");
    }
  }
  async function toggleHistory() {
    if (!result) return;
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    try {
      setAuditEntries(await getHistory(result.session_id));
      setShowHistory(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao abrir o histórico");
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
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (!imageExtensions.test(file.name)) {
                        setDialog({ title: "Formato não reconhecido", message: "Selecione uma imagem TIFF, PNG ou JPEG para o canal nuclear." });
                        event.currentTarget.value = "";
                        return;
                      }
                      setNucleusFile(file);
                    }}
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
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (!imageExtensions.test(file.name)) {
                        setDialog({ title: "Formato não reconhecido", message: "Selecione uma imagem TIFF, PNG ou JPEG para o canal proteico." });
                        event.currentTarget.value = "";
                        return;
                      }
                      setProteinFile(file);
                    }}
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
                <input
                  ref={nucleusFolderInput}
                  className="hidden-folder-input"
                  type="file"
                  multiple
                  {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                  onChange={(event) => selectFolder(event.target.files, "nucleus")}
                />
                <button type="button" className="folder-drop" onClick={() => void pickFolder("nucleus")}>
                  <FolderOpen size={20} />
                  <strong>{folderLabel(nucleusFolder, nucleusFolderName)}</strong>
                  <span>
                    {nucleusFolder.length
                      ? `${nucleusFolder.length} imagens · núcleos`
                      : "Selecionar pasta de núcleos"}
                  </span>
                </button>
                <input
                  ref={proteinFolderInput}
                  className="hidden-folder-input"
                  type="file"
                  multiple
                  {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                  onChange={(event) => selectFolder(event.target.files, "protein")}
                />
                <button type="button" className="folder-drop" onClick={() => void pickFolder("protein")}>
                  <FolderOpen size={20} />
                  <strong>{folderLabel(proteinFolder, proteinFolderName)}</strong>
                  <span>
                    {proteinFolder.length
                      ? `${proteinFolder.length} imagens · proteínas`
                      : "Selecionar pasta de proteínas"}
                  </span>
                </button>
                <button
                  className="primary action-button"
                  onClick={() => void openFolders()}
                  disabled={busy}
                >
                  <Play size={14} /> Processar pastas
                </button>
                <p className="helper-text">
                  <Database size={13} /> Os pares são reconhecidos pelo nome
                  normalizado, não pela ordem dos arquivos. A seleção de pastas
                  usa o seletor seguro do Chrome/Edge.
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
                <History size={15} /> Rastreabilidade
              </span>
            </div>
            <label>
              Responsável pela revisão
              <input
                value={reviewer}
                maxLength={120}
                placeholder="Nome do pesquisador (opcional)"
                onChange={(event) => setReviewer(event.target.value)}
              />
            </label>
            <p className="helper-text">
              O nome é registrado junto às edições e ações de revisão.
            </p>
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
          </section>
          {savedSessions.length ? (
            <section className="batch-section saved-sessions">
              <div className="section-title">
                <span>
                  <History size={15} /> Sessões salvas
                </span>
                <button onClick={() => void refreshSavedSessions()} title="Atualizar sessões">
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="batch-list">
                {savedSessions.map((session) => (
                  <button
                    key={session.session_id}
                    className={`batch-item ${session.session_id === result?.session_id ? "selected" : ""}`}
                    onClick={() => void loadSavedSession(session)}
                  >
                    <span className={`pair-status ${session.status === "ready" ? "ready" : "error"}`} />
                    <span className="pair-name">
                      {session.source_name} · rev. {session.revision}
                    </span>
                    <ChevronRight size={13} />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
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
                {showHistogram ? "Ocultar hist." : batch ? "Hist. desta imagem" : "Histograma"}
              </button>
              <button onClick={() => void saveCurrentSession()} disabled={(!result && !batch) || busy}>
                <Save size={14} /> {saveMessage || (batch ? "Salvar lote e baixar" : "Salvar e baixar")}
              </button>
              <button onClick={() => void toggleHistory()} disabled={!result}>
                <History size={14} /> {showHistory ? "Ocultar histórico" : `Histórico${auditEntries.length ? ` · ${auditEntries.length}` : ""}`}
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
          {result && (showHistogram || showHistory) ? (
            <div
              className={`analysis-context-row ${showHistogram && showHistory ? "split" : "single"}`}
            >
              {showHistogram ? (
                <SessionHistogram
                  result={result}
                  histogramUrl={(kind) => sessionHistogramUrl(result.session_id, kind)}
                  context={batch ? "imagem do lote" : "amostra individual"}
                />
              ) : null}
              {showHistory ? <AuditTrail entries={auditEntries} /> : null}
            </div>
          ) : null}
          {batch ? (
            <BatchSummary
              batch={batch}
              histogramUrl={(kind) => batchHistogramUrl(batch.batch_id, kind)}
              csvUrl={batchCsvUrl(batch.batch_id)}
              packageUrl={batchPackageUrl(batch.batch_id)}
            />
          ) : null}
          {result ? <div className="analysis-grid">
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
                onSelect={(id, modifiers) =>
                  selectNucleus(
                    id,
                    {
                      // Na imagem não há uma ordem linear perceptível: Shift
                      // deve apenas compor a seleção, sem incluir IDs intermediários.
                      additive: modifiers.additive || modifiers.range,
                      range: false,
                    },
                    result?.nuclei ?? [],
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
                <div className="selection-bar">
                  <span className="selection-count">
                    {selected.length
                      ? `${selected.length} núcleo${selected.length === 1 ? "" : "s"} selecionado${selected.length === 1 ? "" : "s"}`
                      : "Selecione por caixa, Ctrl/Cmd ou Shift"}
                  </span>
                  <div className="bulk-actions">
                    <button
                      className="danger"
                      onClick={() => void apply("exclude")}
                      disabled={!selected.length}
                    >
                      Excluir selecionados
                    </button>
                    <button
                      onClick={() => void apply("restore")}
                      disabled={!selected.length}
                    >
                      Restaurar selecionados
                    </button>
                    {selected.length ? (
                      <button
                        onClick={() => {
                          setSelected([]);
                          setSelectionAnchor(null);
                        }}
                      >
                        Limpar
                      </button>
                    ) : null}
                  </div>
                </div>
                <NucleiTable
                  compact
                  nuclei={visibleNuclei}
                  selected={selected}
                  onSelect={(id, modifiers) => selectNucleus(id, modifiers)}
                  onSelectAll={selectAll}
                />
              </section>
            </div>
          </div> : batch ? (
            <section className="batch-state-panel">
              <div className="batch-state-icon">
                {batch.status === "error" ? <AlertTriangle size={27} /> : <Layers3 size={27} />}
              </div>
              <span className="section-label">RESULTADOS DO LOTE</span>
              <h2>
                {batch.status === "error"
                  ? "Nenhum resultado foi gerado"
                  : batchReady
                    ? "Resultados individuais disponíveis"
                    : "Preparando os resultados individuais"}
              </h2>
              <p>
                {batch.status === "error"
                  ? "Confira os itens abaixo e verifique se os nomes dos arquivos de núcleos e proteínas correspondem."
                  : `O lote contém ${batch.total} pares. ${batchReady ? "Selecione um item para abrir a imagem e revisar os núcleos." : "A primeira imagem aparecerá automaticamente assim que terminar."}`}
              </p>
              <div className="batch-state-progress">
                <span style={{ width: `${batch.progress}%` }} />
              </div>
              <div className="batch-state-counts">
                <strong>{batchReady} de {batch.total} pares prontos</strong>
                <span>{batch.failed} sem resultado</span>
              </div>
              <div className="batch-state-list">
                {batch.pairs.map((pair) => (
                  <button
                    key={pair.key}
                    className="batch-state-item"
                    disabled={!pair.session_id || pair.status === "error"}
                    onClick={() => void loadPair(pair)}
                  >
                    <span className={`pair-status ${pair.status}`} />
                    <span>{pair.key.split(/[\\/]/).pop()}</span>
                    <small>
                      {pair.status === "ready" ? "Abrir revisão" : pair.error ?? "Aguardando processamento"}
                    </small>
                    {pair.session_id ? <ChevronRight size={15} /> : null}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="batch-state-panel empty">
              <div className="batch-state-icon"><Microscope size={27} /></div>
              <span className="section-label">ESTAÇÃO DE ANÁLISE</span>
              <h2>Nenhuma imagem carregada</h2>
              <p>Selecione uma amostra ou duas pastas pareadas para iniciar o processamento.</p>
            </section>
          )}
        </main>
      </div>
      <footer className="lab-footer">
        <span>
          <span className="connection-dot" /> API conectada
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
      {dialog && (
        <div className="modal-backdrop" role="presentation">
          <section className="app-modal" role="dialog" aria-modal="true" aria-labelledby="app-modal-title">
            <button className="modal-close" onClick={() => setDialog(null)} aria-label="Fechar">
              <X size={17} />
            </button>
            <span className="modal-icon"><AlertTriangle size={21} /></span>
            <h2 id="app-modal-title">{dialog.title}</h2>
            <p>{dialog.message}</p>
            <div className="modal-actions">
              <button onClick={() => setDialog(null)}>Fechar</button>
              {dialog.onConfirm ? (
                <button className="primary" onClick={dialog.onConfirm}>
                  {dialog.confirmLabel ?? "Continuar"}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
