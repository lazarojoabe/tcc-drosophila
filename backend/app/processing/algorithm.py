from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

from ..models.schemas import SegmentationConfig
from .image_io import read_channel
from .metrics import calculate_metrics, polygon_from_mask

# O CLI existente continua sendo a referência da segmentação. Este pequeno
# adaptador torna seus helpers reutilizáveis sem duplicar Otsu/morfologia.
PROJECT_ROOT = Path(__file__).resolve().parents[3]
SOURCE_ROOT = PROJECT_ROOT / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))
from pipeline_melhorado import PipelineConfig, segment_nuclei  # noqa: E402


def config_to_pipeline(config: SegmentationConfig) -> PipelineConfig:
    return PipelineConfig(
        nucleus_channel=config.nucleus_channel,
        protein_channel=config.protein_channel,
        gaussian_kernel=config.gaussian_kernel,
        gaussian_sigma=config.gaussian_sigma,
        opening_kernel=config.opening_kernel,
        closing_kernel=config.closing_kernel,
        min_nucleus_area=config.min_nucleus_area,
        background_border_width=config.background_border_width,
    )


def process_arrays(
    nucleus_image: np.ndarray, protein_image: np.ndarray, config: SegmentationConfig
) -> dict:
    nucleus_signal = read_channel(
        nucleus_image, config.nucleus_channel, "imagem de núcleos"
    )
    protein_signal = read_channel(
        protein_image, config.protein_channel, "imagem de proteína"
    )
    if nucleus_signal.shape != protein_signal.shape:
        raise ValueError(
            f"Dimensões incompatíveis: {nucleus_signal.shape} vs {protein_signal.shape}"
        )
    labels, mask, threshold = segment_nuclei(nucleus_signal, config_to_pipeline(config))
    background = _background_values(
        labels, protein_signal, config.background_border_width
    )
    background_mean = float(background.mean())
    nuclei: list[dict] = []
    for nucleus_id in range(1, int(labels.max()) + 1):
        nucleus_mask = labels == nucleus_id
        nuclei.append(
            calculate_metrics(
                nucleus_id,
                nucleus_mask,
                nucleus_signal,
                protein_signal,
                background_mean,
                config.pixel_size,
            )
        )
    return {
        "labels": labels,
        "mask": mask,
        "nuclei": nuclei,
        "otsu_threshold": threshold,
        "background_mean": background_mean,
        "background_pixels": int(background.size),
        "shape": {"width": int(labels.shape[1]), "height": int(labels.shape[0])},
        "dtype_nucleus": str(nucleus_image.dtype),
        "dtype_protein": str(protein_image.dtype),
    }


def _background_values(
    labels: np.ndarray, protein: np.ndarray, border_width: int
) -> np.ndarray:
    height, width = labels.shape
    border = np.zeros(labels.shape, dtype=bool)
    border[:border_width, :] = True
    border[max(0, height - border_width) :, :] = True
    border[:, :border_width] = True
    border[:, max(0, width - border_width) :] = True
    border &= labels == 0
    if int(border.sum()) < 100:
        border = labels == 0
    if not int(border.sum()):
        raise ValueError("Não há pixels fora dos núcleos para estimar o fundo")
    return protein[border].astype(np.float64)


def recompute_nucleus(
    nucleus: dict,
    labels: np.ndarray,
    nucleus_signal: np.ndarray,
    protein_signal: np.ndarray,
    config: SegmentationConfig,
    polygon: list[list[float]],
) -> dict:
    height, width = labels.shape
    points = np.asarray(polygon, dtype=np.float32).reshape((-1, 1, 2))
    local_mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(local_mask, [np.rint(points).astype(np.int32)], 1)
    background = _background_values(
        labels, protein_signal, config.background_border_width
    )
    return calculate_metrics(
        nucleus["nucleus_id"],
        local_mask,
        nucleus_signal,
        protein_signal,
        float(background.mean()),
        config.pixel_size,
        polygon,
        nucleus["state"],
    )


def validate_polygon(polygon: list[list[float]], width: int, height: int) -> None:
    if len(polygon) < 3:
        raise ValueError("O contorno deve ter pelo menos três vértices")
    points = np.asarray(polygon, dtype=np.float32)
    if (
        not np.isfinite(points).all()
        or (points[:, 0] < 0).any()
        or (points[:, 0] >= width).any()
        or (points[:, 1] < 0).any()
        or (points[:, 1] >= height).any()
    ):
        raise ValueError("O contorno deve permanecer dentro dos limites da imagem")
    contour = np.rint(points).astype(np.int32).reshape((-1, 1, 2))
    if abs(float(cv2.contourArea(contour))) < 1:
        raise ValueError("O contorno tem área nula")

    # Interseções entre arestas não consecutivas.
    def orientation(a, b, c):
        value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1])
        return int(value > 0) - int(value < 0)

    def intersects(a, b, c, d):
        return orientation(a, b, c) != orientation(a, b, d) and orientation(
            c, d, a
        ) != orientation(c, d, b)

    for index in range(len(points)):
        a, b = points[index], points[(index + 1) % len(points)]
        for other in range(index + 1, len(points)):
            if other in {index, (index + 1) % len(points), (index - 1) % len(points)}:
                continue
            c, d = points[other], points[(other + 1) % len(points)]
            if intersects(a, b, c, d):
                raise ValueError("O contorno não pode se autointersectar")
