export interface TfFrameStatus {
  parentFrame: string;
  childFrame: string;
  available: boolean;
  translation?: { x: number; y: number; z: number };
  rotationQuaternion?: { x: number; y: number; z: number; w: number };
  error?: string;
}

export interface TfTreeResult {
  robotNamespace: string;
  frames: TfFrameStatus[];
  capturedAt: string;
}

export interface OccupancyGridSummary {
  topic: string;
  widthCells: number;
  heightCells: number;
  resolutionMeters: number;
  originX: number;
  originY: number;
  occupiedCells: number;
  freeCells: number;
  unknownCells: number;
  totalCells: number;
  capturedAt: string;
  timedOut?: boolean;
  error?: string;
}

export interface CostmapSummaryResult {
  local?: OccupancyGridSummary;
  global?: OccupancyGridSummary;
}

export interface LaserScanSummary {
  topic: string;
  angleMinRad: number;
  angleMaxRad: number;
  angleIncrementRad: number;
  rangeMinMeters: number;
  rangeMaxMeters: number;
  minRange?: number;
  maxRange?: number;
  meanRange?: number;
  finiteCount: number;
  infCount: number;
  nanCount: number;
  totalCount: number;
  capturedAt: string;
  timedOut?: boolean;
  error?: string;
}

export interface ImuSummary {
  topic: string;
  orientation: { x: number; y: number; z: number; w: number };
  angularVelocity: { x: number; y: number; z: number };
  linearAcceleration: { x: number; y: number; z: number };
  capturedAt: string;
  timedOut?: boolean;
  error?: string;
}

/** One sensor topic discovered under a robot namespace, with an optional one-shot peek. */
export interface SensorDiagnosticEntry {
  topic: string;
  type: string;
  publishers: number;
  /** True when this message type has a peek parser (LaserScan, Imu, …). */
  peekSupported: boolean;
  laserScan?: LaserScanSummary;
  imu?: ImuSummary;
}

export interface RobotSensorDiagnosticsResult {
  robotNamespace: string;
  sensors: SensorDiagnosticEntry[];
  capturedAt: string;
}
