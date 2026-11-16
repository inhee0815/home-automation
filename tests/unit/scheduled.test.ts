import { rawHandler } from '../../netlify/functions/scheduled-automation';
import { AutomationEngine } from '../../src/automation/engine';
jest.mock('../../src/automation/engine');
const evalMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (AutomationEngine as jest.Mock).mockImplementation(() => ({evaluateAndExecute: evalMock}));
  delete process.env.AUTOMATION_ENABLED;
});
test('scheduled function is paused by default', async () => {
  const response = await rawHandler();
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body).skipped).toBe(true);
  expect(evalMock).not.toHaveBeenCalled();
});
test('enabled scheduled function evaluates once', async () => {
  process.env.AUTOMATION_ENABLED = 'true';
  evalMock.mockResolvedValue({action: 'ALREADY_OFF'});
  const response = await rawHandler();
  expect(JSON.parse(response.body).data.action).toBe('ALREADY_OFF');
  expect(evalMock).toHaveBeenCalledTimes(1);
});
test('scheduled function returns sanitized error', async () => {
  process.env.AUTOMATION_ENABLED = 'true';
  evalMock.mockRejectedValue(new Error('secret-data'));
  expect((await rawHandler()).statusCode).toBe(500);
});
