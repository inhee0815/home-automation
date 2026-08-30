import { rawHandler } from '../../netlify/functions/scheduled-automation';
import { AutomationEngine } from '../../src/automation/engine';

jest.mock('../../src/automation/engine');

describe('Scheduled Automation Function', () => {
  let mockEvaluate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEvaluate = jest.fn();
    (AutomationEngine as jest.Mock).mockImplementation(() => ({
      evaluateAndExecute: mockEvaluate,
    }));
  });

  it('should execute evaluation and return 200 OK', async () => {
    mockEvaluate.mockResolvedValueOnce({
      action: 'TURN_ON',
      inductionState: 'ON',
      hoodState: 'ON',
      changed: true,
      remainingDelaySeconds: 0,
      message: 'Induction active. Hood turned ON.',
      evaluatedAt: '2026-08-30T22:22:20.000Z',
    });

    const response = await rawHandler();

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.data.action).toBe('TURN_ON');
    expect(mockEvaluate).toHaveBeenCalled();
  });

  it('should catch engine error and return 500 status', async () => {
    mockEvaluate.mockRejectedValueOnce(new Error('Fatal evaluation crash'));

    const response = await rawHandler();

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Fatal evaluation crash');
  });
});
