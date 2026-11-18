from __future__ import annotations

import csv
import io
import json
import re
import threading
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import numpy as np

from ..models.schemas import ImageDescriptor, SegmentationConfig
from ..processing.algorithm import normalize_polygon, process_arrays, recompute_nucleus
from ..processing.image_io import (
    ImageInfo,
    decode_image,
    mask_png,
    preview_png,
    review_mask_png,
    review_overlay_png,
    safe_filename,
)
from ..processing.metrics import (
    distribution_histogram_png,
)
from ..repositories.filesystem import FilesystemRepository


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Job:
    job_id: str
    session_id: str
    status: str = "queued"
    progress: int = 0
    message: str = "Aguardando processamento"
    error: str | None = None


@dataclass
class SessionState:
    session_id: str
    job_id: str
    config: SegmentationConfig
    warnings: list[str]
    descriptors: list[ImageDescriptor]
    nucleus_image: np.ndarray | None = None
    protein_image: np.ndarray | None = None
    labels: np.ndarray | None = None
    mask: np.ndarray | None = None
    nuclei: list[dict[str, Any]] = field(default_factory=list)
    aggregate: dict[str, Any] = field(default_factory=dict)
    revision: int = 0
    status: str = "queued"
    input_files: dict[str, str] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)
    redo_stack: list[dict[str, Any]] = field(default_factory=list)
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)


@dataclass
class BatchState:
    batch_id: str
    job: Job
    config: SegmentationConfig
    pairs: list[dict[str, Any]]
    status: str = "queued"
    completed: int = 0
    failed: int = 0
    error: str | None = None


class SessionManager:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.repository = FilesystemRepository(data_dir)
        self.executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="nuclei-worker"
        )
        self.batch_executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="batch-monitor"
        )
        self.sessions: dict[str, SessionState] = {}
        self.jobs: dict[str, Job] = {}
        self.batches: dict[str, BatchState] = {}
        self.events: dict[str, list[dict[str, Any]]] = {}
        self.lock = threading.RLock()
        self._restore_sessions()

    def create_session(
        self,
        nucleus_data: bytes,
        nucleus_name: str,
        protein_data: bytes,
        protein_name: str,
        config: SegmentationConfig,
    ) -> SessionState:
        nucleus_name = safe_filename(nucleus_name, "nuclei.tif")
        protein_name = safe_filename(protein_name, "protein.tif")
        nucleus_image, nucleus_info = decode_image(nucleus_data, nucleus_name)
        protein_image, protein_info = decode_image(protein_data, protein_name)
        if (
            nucleus_info.width != protein_info.width
            or nucleus_info.height != protein_info.height
        ):
            raise ValueError("As imagens devem ter as mesmas dimensões")
        if (
            config.nucleus_channel >= nucleus_info.channels
            or config.protein_channel >= protein_info.channels
        ):
            raise ValueError(
                f"Canais inválidos: núcleos têm {nucleus_info.channels}, proteína tem {protein_info.channels}"
            )
        if nucleus_name == protein_name:
            raise ValueError("Os nomes dos arquivos devem ser diferentes")
        warnings: list[str] = []
        if (
            config.input_mode.value == "derived"
            or nucleus_info.derived
            or protein_info.derived
        ):
            warnings.append(
                "A entrada contém nomes compatíveis com resultados derivados; as intensidades podem incluir overlays e não representam necessariamente os TIFFs brutos."
            )
        session_id, job_id = uuid.uuid4().hex, uuid.uuid4().hex
        directory = self.data_dir / session_id
        directory.mkdir(parents=True, exist_ok=False)
        nucleus_path = directory / nucleus_name
        protein_path = directory / protein_name
        nucleus_path.write_bytes(nucleus_data)
        protein_path.write_bytes(protein_data)
        state = SessionState(
            session_id=session_id,
            job_id=job_id,
            config=config,
            warnings=warnings,
            descriptors=[
                ImageDescriptor(
                    name=nucleus_name,
                    role="nucleus",
                    width=nucleus_info.width,
                    height=nucleus_info.height,
                    channels=nucleus_info.channels,
                    dtype=nucleus_info.dtype,
                    derived=nucleus_info.derived,
                ),
                ImageDescriptor(
                    name=protein_name,
                    role="protein",
                    width=protein_info.width,
                    height=protein_info.height,
                    channels=protein_info.channels,
                    dtype=protein_info.dtype,
                    derived=protein_info.derived,
                ),
            ],
            input_files={"nucleus": nucleus_name, "protein": protein_name},
        )
        job = Job(job_id, session_id)
        with self.lock:
            self.sessions[session_id] = state
            self.jobs[job_id] = job
            self.events[session_id] = []
        self._persist(state, operation="session_created")
        self._record_audit(
            state,
            "session_created",
            {"input_files": state.input_files, "source": "upload"},
        )
        self._emit(session_id, job)
        self.executor.submit(self._run_job, state, job, nucleus_image, protein_image)
        return state

    def create_batch(
        self,
        nuclei: list[tuple[bytes, str]],
        proteins: list[tuple[bytes, str]],
        config: SegmentationConfig,
    ) -> BatchState:
        """Pareia duas pastas pelo nome normalizado e inicia uma sessão por par."""

        nucleus_index = _index_batch_files(nuclei, "núcleos")
        protein_index = _index_batch_files(proteins, "proteínas")
        batch_id, job_id = uuid.uuid4().hex, uuid.uuid4().hex
        batch_job = Job(job_id, batch_id, message="Preparando pares de imagens")
        pairs: list[dict[str, Any]] = []
        for key in sorted(set(nucleus_index) | set(protein_index)):
            nucleus = nucleus_index.get(key)
            protein = protein_index.get(key)
            pair: dict[str, Any] = {
                "key": key,
                "nucleus_file": nucleus[1] if nucleus else None,
                "protein_file": protein[1] if protein else None,
                "status": "paired" if nucleus and protein else "incomplete",
                "session_id": None,
                "job_id": None,
                "error": None,
            }
            if nucleus and protein:
                try:
                    session = self.create_session(
                        nucleus[0], nucleus[1], protein[0], protein[1], config
                    )
                    pair["session_id"], pair["job_id"] = (
                        session.session_id,
                        session.job_id,
                    )
                except (OSError, ValueError) as error:
                    pair["status"], pair["error"] = "error", str(error)
            pairs.append(pair)
        batch = BatchState(batch_id, batch_job, config, pairs)
        with self.lock:
            self.batches[batch_id] = batch
            self.jobs[job_id] = batch_job
        self.batch_executor.submit(self._monitor_batch, batch)
        return batch

    def _monitor_batch(self, batch: BatchState) -> None:
        batch.status = "running"
        batch.job.status, batch.job.progress, batch.job.message = (
            "running",
            5,
            "Processando imagens da pasta",
        )
        total = sum(pair["status"] == "paired" for pair in batch.pairs)
        while True:
            completed = failed = 0
            for pair in batch.pairs:
                if pair["status"] == "incomplete":
                    failed += 1
                    continue
                if pair["status"] == "error":
                    failed += 1
                    continue
                try:
                    session = self.get(pair["session_id"])
                    job = self.job(pair["job_id"])
                    if job.status == "completed" or session.status == "ready":
                        pair["status"] = "ready"
                        completed += 1
                    elif job.status == "error" or session.status == "error":
                        pair["status"] = "error"
                        pair["error"] = job.error or "Falha no processamento"
                        failed += 1
                except KeyError:
                    pair["status"], pair["error"] = (
                        "error",
                        "Sessão do par não encontrada",
                    )
                    failed += 1
            batch.completed, batch.failed = completed, failed
            batch.job.progress = (
                100 if total == 0 else min(99, 5 + int(90 * completed / total))
            )
            if completed + failed >= len(batch.pairs):
                batch.status = "completed" if completed else "error"
                batch.job.status = (
                    "completed" if batch.status == "completed" else "error"
                )
                batch.job.progress = 100
                batch.job.message = "Processamento da pasta concluído"
                if failed:
                    batch.job.message = f"Concluído com {failed} par(es) sem resultado"
                return
            time.sleep(0.25)

    def batch_result(self, batch_id: str) -> dict[str, Any]:
        batch = self.batches.get(batch_id)
        if batch is None:
            raise KeyError(batch_id)
        pairs = []
        for pair in batch.pairs:
            payload = dict(pair)
            metrics = self._batch_pair_metrics(pair)
            if metrics is not None:
                payload["metrics"] = metrics
            pairs.append(payload)
        return {
            "batch_id": batch.batch_id,
            "job_id": batch.job.job_id,
            "status": batch.status,
            "progress": batch.job.progress,
            "total": len(batch.pairs),
            "completed": batch.completed,
            "failed": batch.failed,
            "pairs": pairs,
            "summary": self._batch_summary(batch),
            "error": batch.error,
        }

    def _batch_pair_metrics(self, pair: dict[str, Any]) -> dict[str, Any] | None:
        session_id = pair.get("session_id")
        if not session_id:
            return None
        try:
            state = self.get(session_id)
        except KeyError:
            return None
        if state.status != "ready" or not state.aggregate:
            return None
        return {
            "nucleus_count": state.aggregate.get("nucleus_count"),
            "mean_protein": state.aggregate.get("mean_protein"),
            "std_protein": state.aggregate.get("std_protein"),
            "mean_protein_background_corrected": state.aggregate.get(
                "mean_protein_background_corrected"
            ),
            "std_protein_background_corrected": state.aggregate.get(
                "std_protein_background_corrected"
            ),
        }

    def _batch_summary(self, batch: BatchState) -> dict[str, Any]:
        nucleus_counts: list[dict[str, Any]] = []
        protein_std_values: list[dict[str, Any]] = []
        protein_intensities: list[float] = []
        corrected_intensities: list[float] = []
        nucleus_intensities: list[float] = []
        intranuclear_standard_deviations: list[float] = []
        for pair in batch.pairs:
            metrics = self._batch_pair_metrics(pair)
            if metrics is None:
                continue
            nucleus_counts.append(
                {"key": pair["key"], "value": int(metrics["nucleus_count"] or 0)}
            )
            if metrics.get("std_protein") is not None:
                protein_std_values.append(
                    {"key": pair["key"], "value": float(metrics["std_protein"])}
                )
            state = self.get(pair["session_id"])
            protein_intensities.extend(
                float(item["protein_mean"])
                for item in state.nuclei
                if item.get("state") != "excluded"
                and item.get("protein_mean") is not None
            )
            corrected_intensities.extend(
                float(item["protein_mean_background_corrected"])
                for item in state.nuclei
                if item.get("state") != "excluded"
                and item.get("protein_mean_background_corrected") is not None
            )
            nucleus_intensities.extend(
                float(item["nucleus_mean"])
                for item in state.nuclei
                if item.get("state") != "excluded"
                and item.get("nucleus_mean") is not None
            )
            intranuclear_standard_deviations.extend(
                float(item["protein_std"])
                for item in state.nuclei
                if item.get("state") != "excluded"
                and item.get("protein_std") is not None
            )
        return {
            "images_processed": len(nucleus_counts),
            "nuclei_analyzed": len(protein_intensities),
            "mean_protein": (
                float(np.mean(protein_intensities)) if protein_intensities else None
            ),
            "std_protein": (
                float(np.std(protein_intensities)) if protein_intensities else None
            ),
            "mean_corrected_protein": (
                float(np.mean(corrected_intensities)) if corrected_intensities else None
            ),
            "std_corrected_protein": (
                float(np.std(corrected_intensities)) if corrected_intensities else None
            ),
            "mean_nucleus_intensity": (
                float(np.mean(nucleus_intensities)) if nucleus_intensities else None
            ),
            "std_nucleus_intensity": (
                float(np.std(nucleus_intensities)) if nucleus_intensities else None
            ),
            "mean_protein_intranuclear_std": (
                float(np.mean(intranuclear_standard_deviations))
                if intranuclear_standard_deviations
                else None
            ),
            "std_protein_intranuclear_std": (
                float(np.std(intranuclear_standard_deviations))
                if intranuclear_standard_deviations
                else None
            ),
            # Mantido no payload para compatibilidade com análises externas;
            # a interface não o promove como resultado principal.
            "protein_std_values": protein_std_values,
            "nucleus_count_values": nucleus_counts,
        }

    def batch_standard_deviation_histogram(self, batch_id: str) -> bytes:
        return self.batch_histogram(batch_id, "standard-deviation")

    def batch_histogram(self, batch_id: str, kind: str) -> bytes:
        batch = self.batches.get(batch_id)
        if batch is None:
            raise KeyError(batch_id)
        summary = self._batch_summary(batch)
        if kind == "standard-deviation":
            values = self._batch_histogram_values(batch, "protein_std")
            return distribution_histogram_png(
                values,
                "Distribuição do desvio padrão intranuclear proteico no lote",
                "Desvio padrão da intensidade proteica em cada núcleo",
            )
        if kind == "nuclei":
            values = [item["value"] for item in summary["nucleus_count_values"]]
            return distribution_histogram_png(
                values,
                "Distribuicao do numero de nucleos por imagem",
                "Nucleos detectados por imagem",
            )
        if kind == "protein":
            values = self._batch_histogram_values(batch, "protein_mean")
            return distribution_histogram_png(
                values,
                "Distribuição da intensidade proteica no lote",
                "Intensidade média da proteína",
            )
        if kind == "nucleus":
            values = self._batch_histogram_values(batch, "nucleus_mean")
            return distribution_histogram_png(
                values,
                "Distribuição da intensidade nuclear no lote",
                "Intensidade média do núcleo",
            )
        raise ValueError(f"Tipo de histograma desconhecido: {kind}")

    def _batch_histogram_values(self, batch: BatchState, metric: str) -> list[float]:
        values: list[float] = []
        for pair in batch.pairs:
            if self._batch_pair_metrics(pair) is None:
                continue
            state = self.get(pair["session_id"])
            with state.lock:
                values.extend(
                    float(item[metric])
                    for item in state.nuclei
                    if item.get("state") != "excluded" and item.get(metric) is not None
                )
        return values

    def _run_job(
        self,
        state: SessionState,
        job: Job,
        nucleus_image: np.ndarray,
        protein_image: np.ndarray,
    ) -> None:
        try:
            job.status, job.progress, job.message = (
                "running",
                15,
                "Validando canais e segmentando",
            )
            self._emit(state.session_id, job)
            result = process_arrays(nucleus_image, protein_image, state.config)
            with state.lock:
                state.nucleus_image, state.protein_image = nucleus_image, protein_image
                state.labels, state.mask = result["labels"], result["mask"]
                state.nuclei, state.aggregate = result["nuclei"], aggregate(
                    result["nuclei"]
                )
                state.status = "ready"
            job.status, job.progress, job.message = (
                "completed",
                100,
                "Processamento concluído",
            )
            self._persist(state, operation="processing_completed")
            self._record_audit(
                state,
                "processing_completed",
                {"nuclei_detected": len(state.nuclei)},
            )
            self._emit(state.session_id, job)
        except Exception as error:  # pragma: no cover - caminho exercitado por endpoint
            state.status = "error"
            job.status, job.progress, job.message, job.error = (
                "error",
                100,
                "Falha no processamento",
                str(error),
            )
            self._persist(state, operation="processing_failed")
            self._record_audit(
                state, "processing_failed", {"error": str(error)}
            )
            self._emit(state.session_id, job)

    def _emit(self, session_id: str, job: Job) -> None:
        with self.lock:
            self.events.setdefault(session_id, []).append(
                {"event": "job", "data": job_payload(job)}
            )

    def events_after(
        self, session_id: str, cursor: int
    ) -> tuple[int, list[dict[str, Any]]]:
        with self.lock:
            all_events = self.events.get(session_id, [])
            # A assinatura SSE usa um cursor grande para pular eventos antigos.
            # Normalize-o para o fim real da fila; caso contrário, eventos novos
            # nunca seriam observados e a interface ficaria parada em 15%.
            cursor = min(max(cursor, 0), len(all_events))
            events = all_events[cursor:]
            return cursor + len(events), events

    def get(self, session_id: str) -> SessionState:
        state = self.sessions.get(session_id)
        if state is None:
            raise KeyError(session_id)
        return state

    def job(self, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def apply_edit(self, session_id: str, request: Any) -> dict[str, Any]:
        state = self.get(session_id)
        with state.lock:
            self._check_revision(state, request.base_revision)
            before = self._snapshot(state)
            affected = request.nucleus_ids or (
                [request.nucleus_id] if request.nucleus_id else []
            )
            audit_details: dict[str, Any] = {"nucleus_ids": affected}
            by_id = {item["nucleus_id"]: item for item in state.nuclei}
            if request.operation == "edit_contour":
                if len(affected) != 1 or request.polygon is None:
                    raise ValueError("edit_contour exige nucleus_id e polygon")
                if (
                    affected[0] not in by_id
                    or state.labels is None
                    or state.nucleus_image is None
                    or state.protein_image is None
                ):
                    raise KeyError("Núcleo não encontrado")
                polygon, auto_corrected = normalize_polygon(
                    request.polygon, state.labels.shape[1], state.labels.shape[0]
                )
                by_id[affected[0]] = recompute_nucleus(
                    by_id[affected[0]],
                    state.labels,
                    state.nucleus_image.astype(np.float32),
                    state.protein_image.astype(np.float32),
                    state.config,
                    polygon,
                )
                audit_details.update(
                    {
                        "contour_points": len(polygon),
                        "contour_auto_corrected": auto_corrected,
                    }
                )
            else:
                if not affected:
                    raise ValueError("Informe pelo menos um nucleus_id")
                for nucleus_id in affected:
                    if nucleus_id not in by_id:
                        raise KeyError(f"Núcleo não encontrado: {nucleus_id}")
                    if (
                        request.operation == "hide"
                        and by_id[nucleus_id]["state"] != "excluded"
                    ):
                        by_id[nucleus_id]["state"] = "hidden"
                    elif request.operation == "exclude":
                        by_id[nucleus_id]["state"] = "excluded"
                    elif request.operation == "restore":
                        by_id[nucleus_id]["state"] = "active"
            state.nuclei = [by_id[item["nucleus_id"]] for item in state.nuclei]
            state.aggregate = aggregate(state.nuclei)
            state.revision += 1
            state.history.append(before)
            state.redo_stack.clear()
            self._persist(state, operation=request.operation)
            self._record_audit(
                state, request.operation, audit_details, request.reviewer
            )
            return self.result(session_id)

    def undo(
        self,
        session_id: str,
        revision: int,
        redo: bool = False,
        reviewer: str | None = None,
    ) -> dict[str, Any]:
        state = self.get(session_id)
        with state.lock:
            self._check_revision(state, revision)
            stack = state.redo_stack if redo else state.history
            if not stack:
                raise ValueError(
                    "Não há edição para refazer"
                    if redo
                    else "Não há edição para desfazer"
                )
            current = self._snapshot(state)
            target = stack.pop()
            (state.history if redo else state.redo_stack).append(current)
            self._restore_snapshot(state, target)
            state.revision += 1
            operation = "redo" if redo else "undo"
            self._persist(state, operation=operation)
            self._record_audit(state, operation, {}, reviewer)
            return self.result(session_id)

    def reprocess(
        self,
        session_id: str,
        revision: int,
        config: SegmentationConfig | None = None,
        reviewer: str | None = None,
    ) -> Job:
        state = self.get(session_id)
        with state.lock:
            self._check_revision(state, revision)
            if state.nucleus_image is None or state.protein_image is None:
                raise ValueError("A sessão ainda não terminou o processamento inicial")
            if config is not None:
                state.config = config
            state.status = "queued"
            state.revision += 1
            state.history.clear()
            state.redo_stack.clear()
            job_id = uuid.uuid4().hex
            job = Job(job_id, session_id)
            state.job_id = job_id
            with self.lock:
                self.jobs[job_id] = job
            self._persist(state, operation="reprocess_requested")
            self._record_audit(
                state,
                "reprocess_requested",
                {"config": model_dump(state.config)},
                reviewer,
            )
            self.executor.submit(
                self._run_job, state, job, state.nucleus_image, state.protein_image
            )
            return job

    def result(self, session_id: str) -> dict[str, Any]:
        state = self.get(session_id)
        with state.lock:
            return {
                "session_id": state.session_id,
                "revision": state.revision,
                "status": state.status,
                "config": model_dump(state.config),
                "warnings": state.warnings,
                "shape": self._shape(state),
                "nuclei": state.nuclei,
                "aggregate": state.aggregate,
                "job_id": state.job_id,
            }

    def export_csv(self, session_id: str) -> bytes:
        result = self.result(session_id)
        output = io.StringIO()
        rows = result["nuclei"]
        fields = sorted({key for row in rows for key in row if key != "polygon"})
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: value for key, value in row.items() if key in fields})
        return output.getvalue().encode("utf-8-sig")

    def export_batch_csv(self, batch_id: str) -> bytes:
        batch = self.batches.get(batch_id)
        if batch is None:
            raise KeyError(batch_id)
        output = io.StringIO()
        fields = [
            "key",
            "status",
            "nucleus_file",
            "protein_file",
            "session_id",
            "nucleus_count",
            "mean_protein",
            "std_protein",
            "mean_protein_background_corrected",
            "std_protein_background_corrected",
            "error",
        ]
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for pair in batch.pairs:
            metrics = self._batch_pair_metrics(pair) or {}
            writer.writerow(
                {
                    "key": pair["key"],
                    "status": pair["status"],
                    "nucleus_file": pair.get("nucleus_file"),
                    "protein_file": pair.get("protein_file"),
                    "session_id": pair.get("session_id"),
                    "nucleus_count": metrics.get("nucleus_count"),
                    "mean_protein": metrics.get("mean_protein"),
                    "std_protein": metrics.get("std_protein"),
                    "mean_protein_background_corrected": metrics.get(
                        "mean_protein_background_corrected"
                    ),
                    "std_protein_background_corrected": metrics.get(
                        "std_protein_background_corrected"
                    ),
                    "error": pair.get("error"),
                }
            )
        return output.getvalue().encode("utf-8-sig")

    def export_batch_package(self, batch_id: str) -> bytes:
        """Exporta o lote consolidado e cada sessão individual em um único ZIP."""

        batch = self.batches.get(batch_id)
        if batch is None:
            raise KeyError(batch_id)
        output = io.BytesIO()
        with zipfile.ZipFile(
            output, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=6
        ) as archive:
            archive.writestr(
                "README.txt",
                (
                    "Pacote de processamento em lote\n\n"
                    "batch.json e batch.csv contêm o resumo e as métricas por par.\n"
                    "histograms/ contém os histogramas consolidados de proteína, núcleo e DP.\n"
                    "sessions/<par>/ contém o pacote completo de cada imagem, incluindo\n"
                    "originais, prévias, máscara, sobreposição, métricas e auditoria.\n"
                ),
            )
            archive.writestr(
                "batch.json",
                json.dumps(self.batch_result(batch_id), ensure_ascii=False, indent=2),
            )
            archive.writestr("batch.csv", self.export_batch_csv(batch_id))
            for kind in ("protein", "nucleus", "standard-deviation"):
                archive.writestr(
                    f"histograms/{kind}.png", self.batch_histogram(batch_id, kind)
                )
            for pair in batch.pairs:
                session_id = pair.get("session_id")
                if not session_id:
                    continue
                state = self.sessions.get(session_id)
                if state is None or state.status != "ready":
                    continue
                key = safe_filename(f"{pair['key']}.png")[:-4]
                package = self.export_package(session_id)
                with zipfile.ZipFile(io.BytesIO(package)) as session_archive:
                    for item in session_archive.infolist():
                        if item.is_dir():
                            continue
                        archive.writestr(
                            f"sessions/{key}/{item.filename}",
                            session_archive.read(item),
                        )
        return output.getvalue()

    def export_json(self, session_id: str) -> bytes:
        state = self.get(session_id)
        payload = {
            **self.result(session_id),
            "history": state.history,
            "audit": self.audit_history(session_id),
        }
        return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")

    def export_package(self, session_id: str) -> bytes:
        """Exporta uma fotografia completa, portátil e auditável da análise."""

        state = self.get(session_id)
        directory = self.repository.session_dir(session_id)
        output = io.BytesIO()
        with zipfile.ZipFile(
            output, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=6
        ) as archive:
            archive.writestr(
                "README.txt",
                (
                    "Pacote de análise morfológica e quantificação\n"
                    "\n"
                    "analysis.json: resultado atual, configuração e histórico.\n"
                    "nuclei.csv: métricas tabulares por núcleo (sem o polígono).\n"
                    "audit.jsonl: trilha de auditoria das operações realizadas.\n"
                    "histograms/: histogramas PNG individuais da sessão.\n"
                    "images/: prévias normalizadas, máscara e sobreposição de revisão.\n"
                    "original/: arquivos originais usados na análise.\n"
                    "revisions/: fotografias imutáveis de cada revisão persistida.\n"
                ),
            )
            archive.writestr("analysis.json", self.export_json(session_id))
            archive.writestr("nuclei.csv", self.export_csv(session_id))
            audit = self.audit_history(session_id)
            archive.writestr(
                "audit.jsonl",
                "".join(json.dumps(entry, ensure_ascii=False) + "\n" for entry in audit),
            )

            histogram_names = {
                "protein": "histograms/protein.png",
                "nucleus": "histograms/nucleus.png",
                "standard-deviation": "histograms/standard-deviation.png",
            }
            for kind, name in histogram_names.items():
                archive.writestr(name, self.session_histogram(session_id, kind))

            for kind in ("nucleus", "protein", "mask"):
                archive.writestr(f"images/{kind}.png", self.image_bytes(session_id, kind))
            with state.lock:
                if state.nucleus_image is not None:
                    archive.writestr(
                        "images/review-overlay.png",
                        review_overlay_png(
                            state.nucleus_image,
                            state.config.nucleus_channel,
                            state.nuclei,
                        ),
                    )
                if state.protein_image is not None:
                    archive.writestr(
                        "images/protein-review-overlay.png",
                        review_overlay_png(
                            state.protein_image,
                            state.config.protein_channel,
                            state.nuclei,
                        ),
                    )
                if state.labels is not None:
                    archive.writestr(
                        "images/review-mask.png",
                        review_mask_png(state.labels.shape[:2], state.nuclei),
                    )

            for role, filename in state.input_files.items():
                source = directory / filename
                if source.is_file():
                    archive.writestr(f"original/{role}-{safe_filename(filename)}", source.read_bytes())

            revisions = directory / "revisions"
            if revisions.is_dir():
                for revision in sorted(revisions.glob("revision-*.json")):
                    archive.writestr(f"revisions/{revision.name}", revision.read_bytes())
        return output.getvalue()

    def protein_mean_histogram(self, session_id: str) -> bytes:
        return self.session_histogram(session_id, "protein")

    def session_histogram(self, session_id: str, kind: str) -> bytes:
        state = self.get(session_id)
        specifications = {
            "protein": (
                "protein_mean",
                "Distribuição da intensidade proteica por núcleo",
                "Intensidade média da proteína",
            ),
            "nucleus": (
                "nucleus_mean",
                "Distribuição da intensidade nuclear por núcleo",
                "Intensidade média do núcleo",
            ),
            "standard-deviation": (
                "protein_std",
                "Distribuição do desvio padrão intranuclear proteico",
                "Desvio padrão da intensidade proteica em cada núcleo",
            ),
        }
        if kind not in specifications:
            raise ValueError(f"Tipo de histograma desconhecido: {kind}")
        metric, title, x_label = specifications[kind]
        with state.lock:
            values = [
                float(item[metric])
                for item in state.nuclei
                if item.get("state") != "excluded"
                and item.get(metric) is not None
            ]
        return distribution_histogram_png(values, title, x_label)

    def image_bytes(self, session_id: str, kind: str) -> bytes:
        state = self.get(session_id)
        with state.lock:
            if kind == "nucleus" and state.nucleus_image is not None:
                return preview_png(state.nucleus_image, state.config.nucleus_channel)
            if kind == "protein" and state.protein_image is not None:
                return preview_png(state.protein_image, state.config.protein_channel)
            if kind == "mask" and state.labels is not None:
                return mask_png(state.labels)
        raise ValueError("Imagem ainda não disponível")

    def _check_revision(self, state: SessionState, base_revision: int) -> None:
        if base_revision != state.revision:
            raise RevisionConflict(state.revision, self.result(state.session_id))

    def _snapshot(self, state: SessionState) -> dict[str, Any]:
        return {
            "nuclei": json.loads(json.dumps(state.nuclei)),
            "config": model_dump(state.config),
            "revision": state.revision,
        }

    def _restore_snapshot(self, state: SessionState, snapshot: dict[str, Any]) -> None:
        state.nuclei = snapshot["nuclei"]
        state.config = SegmentationConfig(**snapshot["config"])
        state.aggregate = aggregate(state.nuclei)

    def _shape(self, state: SessionState) -> dict[str, int] | None:
        return (
            {"width": int(state.labels.shape[1]), "height": int(state.labels.shape[0])}
            if state.labels is not None
            else None
        )

    def _persist(self, state: SessionState, operation: str = "state_saved") -> None:
        """Grava estado atual e uma fotografia imutável da revisão em arquivos."""

        now = utc_now()
        job = self.jobs.get(state.job_id, Job(state.job_id, state.session_id))
        result = {
            "session_id": state.session_id,
            "revision": state.revision,
            "status": state.status,
            "config": model_dump(state.config),
            "warnings": state.warnings,
            "shape": self._shape(state),
            "nuclei": state.nuclei,
            "aggregate": state.aggregate,
            "job_id": state.job_id,
        }
        payload = {
            "schema_version": 1,
            "saved_at": now,
            "result": result,
            "job": job_payload(job),
            "descriptors": [model_dump(item) for item in state.descriptors],
            "input_files": state.input_files,
            "history": state.history,
            "redo_stack": state.redo_stack,
        }
        self.repository.save_state(
            state.session_id, payload, state.labels, state.mask
        )
        self.repository.save_revision(
            state.session_id, state.revision, result, operation, now
        )

    def _record_audit(
        self,
        state: SessionState,
        operation: str,
        details: dict[str, Any],
        reviewer: str | None = None,
    ) -> None:
        self.repository.append_audit(
            state.session_id,
            {
                "timestamp": utc_now(),
                "revision": state.revision,
                "operation": operation,
                "reviewer": reviewer.strip() if reviewer and reviewer.strip() else "Não informado",
                "details": details,
            },
        )

    def audit_history(self, session_id: str) -> list[dict[str, Any]]:
        self.get(session_id)
        return self.repository.history(session_id)

    def save(self, session_id: str, reviewer: str | None = None) -> dict[str, Any]:
        """Força uma fotografia do estado atual sem criar uma nova revisão."""

        state = self.get(session_id)
        with state.lock:
            self._persist(state, operation="manual_save")
            self._record_audit(state, "manual_save", {}, reviewer)
            return self.result(session_id)

    def save_batch(self, batch_id: str, reviewer: str | None = None) -> dict[str, Any]:
        """Persiste todas as sessões prontas que compõem um lote."""

        batch = self.batches.get(batch_id)
        if batch is None:
            raise KeyError(batch_id)
        for pair in batch.pairs:
            session_id = pair.get("session_id")
            state = self.sessions.get(session_id) if session_id else None
            if state is not None and state.status == "ready":
                self.save(session_id, reviewer)
        return self.batch_result(batch_id)

    def list_sessions(self) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for state in self.sessions.values():
            path = self.repository.session_dir(state.session_id) / "session.json"
            updated_at = datetime.fromtimestamp(
                path.stat().st_mtime, timezone.utc
            ).isoformat() if path.exists() else ""
            entries.append(
                {
                    "session_id": state.session_id,
                    "status": state.status,
                    "revision": state.revision,
                    "updated_at": updated_at,
                    "source_name": state.descriptors[0].name if state.descriptors else "Amostra sem nome",
                    "nucleus_count": state.aggregate.get("nucleus_count"),
                }
            )
        return sorted(entries, key=lambda item: item["updated_at"], reverse=True)

    def _restore_sessions(self) -> None:
        """Restaura análises concluídas após reinicializar a aplicação local."""

        for directory, payload in self.repository.states():
            try:
                result = payload["result"]
                session_id = str(result["session_id"])
                input_files = dict(payload["input_files"])
                nucleus_data = (directory / input_files["nucleus"]).read_bytes()
                protein_data = (directory / input_files["protein"]).read_bytes()
                nucleus_image, _ = decode_image(nucleus_data, input_files["nucleus"])
                protein_image, _ = decode_image(protein_data, input_files["protein"])
                labels = mask = None
                arrays_path = directory / "analysis.npz"
                if arrays_path.exists():
                    with np.load(arrays_path, allow_pickle=False) as arrays:
                        labels = arrays["labels"]
                        mask = arrays["mask"]
                state = SessionState(
                    session_id=session_id,
                    job_id=str(result["job_id"]),
                    config=SegmentationConfig(**result["config"]),
                    warnings=list(result.get("warnings", [])),
                    descriptors=[
                        ImageDescriptor(**item)
                        for item in payload.get("descriptors", [])
                    ],
                    nucleus_image=nucleus_image,
                    protein_image=protein_image,
                    labels=labels,
                    mask=mask,
                    nuclei=list(result.get("nuclei", [])),
                    aggregate=dict(result.get("aggregate", {})),
                    revision=int(result.get("revision", 0)),
                    status=str(result.get("status", "error")),
                    input_files=input_files,
                    history=list(payload.get("history", [])),
                    redo_stack=list(payload.get("redo_stack", [])),
                )
                job_data = dict(payload.get("job", {}))
                job = Job(
                    job_id=state.job_id,
                    session_id=session_id,
                    status=str(job_data.get("status", "completed")),
                    progress=int(job_data.get("progress", 100)),
                    message=str(job_data.get("message", "Sessão restaurada")),
                    error=job_data.get("error"),
                )
                if state.status == "ready":
                    job.status, job.progress = "completed", 100
                elif job.status in {"queued", "running"}:
                    state.status = job.status = "error"
                    job.progress = 100
                    job.message = "Processamento interrompido pela reinicialização"
                self.sessions[session_id] = state
                self.jobs[job.job_id] = job
                self.events[session_id] = []
            except (KeyError, OSError, ValueError, json.JSONDecodeError):
                continue


class RevisionConflict(Exception):
    def __init__(self, current_revision: int, result: dict[str, Any]) -> None:
        super().__init__("A revisão da sessão mudou")
        self.current_revision, self.result = current_revision, result


def model_dump(model: Any) -> dict[str, Any]:
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


def aggregate(nuclei: list[dict[str, Any]]) -> dict[str, Any]:
    from ..processing.metrics import aggregate_metrics

    return aggregate_metrics(nuclei)


def job_payload(job: Job) -> dict[str, Any]:
    return {
        "job_id": job.job_id,
        "session_id": job.session_id,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "error": job.error,
    }


def _batch_key(name: str) -> str:
    normalized = name.replace("\\", "/").strip("/")
    # O navegador envia diretórios selecionados como `pasta/arquivo.tif`.
    # Núcleos e proteínas normalmente vêm de pastas diferentes, portanto o
    # diretório não pode participar da chave de pareamento.
    basename = normalized.rsplit("/", 1)[-1]
    stem = re.sub(r"\.[^.\/]+$", "", basename)
    stem = re.sub(r"(?:_z0)?_ch(?:00|02)$", "", stem, flags=re.IGNORECASE)
    return stem.casefold()


def _index_batch_files(
    files: list[tuple[bytes, str]], role: str
) -> dict[str, tuple[bytes, str]]:
    indexed: dict[str, tuple[bytes, str]] = {}
    for data, name in files:
        key = _batch_key(name)
        if not key:
            raise ValueError(f"Arquivo sem nome válido na pasta de {role}")
        if key in indexed:
            raise ValueError(
                f"Arquivos duplicados para o par {key!r} na pasta de {role}"
            )
        indexed[key] = (data, name)
    return indexed
