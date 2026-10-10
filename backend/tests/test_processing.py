from __future__ import annotations

import unittest

import cv2
import numpy as np

from backend.app.models.schemas import SegmentationConfig
from backend.app.processing.algorithm import process_arrays, validate_polygon
from backend.app.processing.metrics import aggregate_metrics


class ProcessingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.nucleus = np.zeros((96, 96), dtype=np.uint8)
        cv2.circle(self.nucleus, (30, 35), 12, 220, -1)
        cv2.circle(self.nucleus, (68, 65), 10, 230, -1)
        self.protein = np.full((96, 96), 10, dtype=np.uint16)
        self.protein[self.nucleus > 0] = 1300

    def test_metrics_preserve_16_bit_protein_values(self) -> None:
        result = process_arrays(self.nucleus, self.protein, SegmentationConfig(min_nucleus_area=30, protein_channel=0))
        self.assertEqual(len(result["nuclei"]), 2)
        self.assertGreater(result["nuclei"][0]["protein_mean"], 1000)
        self.assertEqual(result["nuclei"][0]["state"], "active")

    def test_polygon_bounds_and_self_intersection(self) -> None:
        validate_polygon([[1, 1], [10, 1], [10, 10], [1, 10]], 20, 20)
        with self.assertRaises(ValueError):
            validate_polygon([[1, 1], [10, 10], [1, 10], [10, 1]], 20, 20)
        with self.assertRaises(ValueError):
            validate_polygon([[-1, 1], [10, 1], [10, 10]], 20, 20)

    def test_grayscale_channel_validation(self) -> None:
        with self.assertRaises(ValueError):
            process_arrays(self.nucleus, self.protein, SegmentationConfig(protein_channel=1))

    def test_aggregate_reports_mean_and_standard_deviation(self) -> None:
        nuclei = [
            {"state": "active", "area_px": 10, "protein_mean": 10.0, "protein_mean_background_corrected": 8.0, "nucleus_mean": 20.0},
            {"state": "active", "area_px": 12, "protein_mean": 14.0, "protein_mean_background_corrected": 12.0, "nucleus_mean": 24.0},
        ]
        aggregate = aggregate_metrics(nuclei)
        self.assertEqual(aggregate["mean_protein"], 12.0)
        self.assertAlmostEqual(aggregate["std_protein"], 2.0)
        self.assertEqual(aggregate["mean_protein_background_corrected"], 10.0)
        self.assertAlmostEqual(aggregate["std_nucleus_intensity"], 2.0)


if __name__ == "__main__":
    unittest.main()
