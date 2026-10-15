export interface RosbagRecording {
  containerId: string;
  topics: string[];
  outputPath: string;
  status: 'recording' | 'stopping' | 'complete' | 'cancelled' | 'failed';
  startedAt: number;
  finishedAt?: number;
  error?: string;
}
