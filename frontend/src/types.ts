export type NucleusState = "active" | "hidden" | "excluded";

export interface Nucleus {
  nucleus_id: number;
  area_px: number;
  area_um2: number | null;
  centroid_x: number;
  centroid_y: number;
  bounding_box: { x: number; y: number; width: number; height: number };
  perimeter_px: number | null;
  equivalent_radius_px: number | null;
  equivalent_diameter_px: number | null;
  major_axis_px: number | null;
  minor_axis_px: number | null;
  eccentricity: number | null;
  circularity: number | null;
  nucleus_mean: number | null;
  nucleus_median: number | null;
  nucleus_std: number | null;
  nucleus_integrated: number | null;
  protein_mean: number | null;
  protein_median: number | null;
  protein_std: number | null;
  protein_integrated: number | null;
  background_mean: number | null;
  protein_mean_background_corrected: number | null;
  state: NucleusState;
  polygon: [number, number][];
}

export interface Config {
  nucleus_channel: number;
  protein_channel: number;
  gaussian_kernel: number;
  gaussian_sigma: number;
  opening_kernel: number;
  closing_kernel: number;
  min_nucleus_area: number;
  background_border_width: number;
  pixel_size: number | null;
  pixel_unit: string;
  input_mode: "auto" | "raw" | "derived";
}
export interface ImageDescriptor {
  name: string;
  role: "nucleus" | "protein";
  width: number;
  height: number;
  channels: number;
  dtype: string;
  derived: boolean;
}
export interface Session {
  session_id: string;
  job_id: string;
  status: string;
  revision: number;
  config: Config;
  warnings: string[];
  images: ImageDescriptor[];
}
export interface SavedSession {
  session_id: string;
  status: string;
  revision: number;
  updated_at: string;
  source_name: string;
  nucleus_count: number | null;
}
export interface AggregateMetrics {
  nucleus_count: number;
  visible_count: number;
  excluded_count: number;
  hidden_count: number;
  total_area_px: number;
  mean_protein: number | null;
  std_protein: number | null;
  mean_protein_background_corrected: number | null;
  std_protein_background_corrected: number | null;
  mean_nucleus_intensity: number | null;
  std_nucleus_intensity: number | null;
  mean_protein_intranuclear_std: number | null;
  std_protein_intranuclear_std: number | null;
}
export interface Result {
  session_id: string;
  revision: number;
  status: string;
  config: Config;
  warnings: string[];
  shape: { width: number; height: number } | null;
  nuclei: Nucleus[];
  aggregate: AggregateMetrics;
  job_id: string;
}
export interface Job {
  job_id: string;
  session_id: string;
  status: string;
  progress: number;
  message: string;
  error: string | null;
}
export interface AuditEntry {
  timestamp: string;
  revision: number;
  operation: string;
  reviewer: string;
  details: Record<string, unknown>;
}
export interface BatchPairMetrics {
  nucleus_count: number | null;
  mean_protein: number | null;
  std_protein: number | null;
  mean_protein_background_corrected: number | null;
  std_protein_background_corrected: number | null;
}
export interface BatchPair {
  key: string;
  nucleus_file: string | null;
  protein_file: string | null;
  session_id: string | null;
  job_id: string | null;
  status: "paired" | "incomplete" | "error" | "ready";
  metrics?: BatchPairMetrics;
  error: string | null;
}
export interface BatchSummary {
  images_processed: number;
  nuclei_analyzed: number;
  mean_corrected_protein: number | null;
  std_corrected_protein: number | null;
  mean_nucleus_intensity: number | null;
  std_nucleus_intensity: number | null;
  mean_protein_intranuclear_std: number | null;
  std_protein_intranuclear_std: number | null;
  nucleus_count_values: { key: string; value: number }[];
}
export interface Batch {
  batch_id: string;
  job_id: string;
  status: "queued" | "running" | "completed" | "error";
  progress: number;
  total: number;
  completed: number;
  failed: number;
  pairs: BatchPair[];
  summary?: BatchSummary;
  error: string | null;
}
