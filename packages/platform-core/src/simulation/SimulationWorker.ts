/// <reference types="node" />
import { parentPort, workerData } from 'worker_threads';
import { SimulationRunner } from '../lua/SimulationRunner';
import type { SimulationConfig, SimulationResult } from '../lua/types';

export interface WorkerMessage {
  type: 'progress' | 'result' | 'error';
  progress?: { completed: number; total: number };
  result?: SimulationResult;
  error?: string;
}

export interface WorkerConfig {
  config: Omit<SimulationConfig, 'onProgress' | 'workerCount'>;
}

function run() {
  const { config } = workerData as WorkerConfig;

  const runner = new SimulationRunner({
    ...config,
    onProgress: (completed, total) => {
      parentPort!.postMessage({
        type: 'progress',
        progress: { completed, total },
      } satisfies WorkerMessage);
    },
  });

  try {
    const result = runner.run();
    parentPort!.postMessage({
      type: 'result',
      result,
    } satisfies WorkerMessage);
  } catch (e: any) {
    parentPort!.postMessage({
      type: 'error',
      error: e.message ?? String(e),
    } satisfies WorkerMessage);
  }
}

run();
