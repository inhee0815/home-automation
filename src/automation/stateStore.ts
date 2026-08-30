import fs from 'fs';
import path from 'path';
import { AutomationStoreState } from './types';

const STATE_FILE_PATH = process.env.AUTOMATION_STATE_PATH || path.join('/tmp', 'lg-hood-automation-state.json');

let memoryState: AutomationStoreState = {
  lastInductionState: 'UNKNOWN',
  lastActiveTimestamp: 0,
  lastOffDetectedTimestamp: 0,
  lastHoodCommand: 'NONE',
  lastEvaluatedAt: 0,
};

export class AutomationStateStore {
  public static loadState(): AutomationStoreState {
    try {
      if (fs.existsSync(STATE_FILE_PATH)) {
        const raw = fs.readFileSync(STATE_FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        memoryState = {
          ...memoryState,
          ...parsed,
        };
      }
    } catch {
      // Fallback to memoryState if file read fails
    }
    return { ...memoryState };
  }

  public static saveState(newState: Partial<AutomationStoreState>): AutomationStoreState {
    memoryState = {
      ...memoryState,
      ...newState,
      lastEvaluatedAt: Date.now(),
    };

    try {
      const dir = path.dirname(STATE_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(memoryState, null, 2), 'utf8');
    } catch {
      // Ignore file write errors in restricted environments
    }

    return { ...memoryState };
  }

  public static resetState(): void {
    memoryState = {
      lastInductionState: 'UNKNOWN',
      lastActiveTimestamp: 0,
      lastOffDetectedTimestamp: 0,
      lastHoodCommand: 'NONE',
      lastEvaluatedAt: 0,
    };
    try {
      if (fs.existsSync(STATE_FILE_PATH)) {
        fs.unlinkSync(STATE_FILE_PATH);
      }
    } catch {
      // Ignore
    }
  }
}
