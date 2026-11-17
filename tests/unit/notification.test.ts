jest.mock('@netlify/blobs',()=>({getStore:jest.fn()}));
import {getStore} from '@netlify/blobs';
import {notifyIncident,classifyAutomationFailure} from '../../src/automation/notification';
import type {AutomationResult} from '../../src/automation/types';
const store={get:jest.fn(),setJSON:jest.fn()};
beforeEach(()=>{jest.clearAllMocks();(getStore as jest.Mock).mockReturnValue(store);store.get.mockResolvedValue(null);store.setJSON.mockResolvedValue(undefined);jest.spyOn(console,'warn').mockImplementation(()=>undefined)});
afterEach(()=>jest.restoreAllMocks());
test('records incident without external push',async()=>{
 await notifyIncident('LG_UNAVAILABLE','LG unavailable',1000000);
 expect(store.setJSON).toHaveBeenCalled();
});
test('repeated incident logs suppressed while count increments',async()=>{
 store.get.mockResolvedValue({lastLoggedAt:1000000,count:1});
 expect(await notifyIncident('LG_UNAVAILABLE','LG unavailable',1010000)).toBe(false);
 expect(store.setJSON).toHaveBeenCalledWith('incidents/LG_UNAVAILABLE',expect.objectContaining({count:2}));
});
test('classifies LG error',()=>{
 const r:AutomationResult={action:'SKIPPED_LG_ERROR',inductionState:'UNKNOWN',hoodState:'UNKNOWN',changed:false,remainingDelaySeconds:0,message:'LG unavailable',evaluatedAt:'2026-11-17T00:00:00Z'};
 expect(classifyAutomationFailure(r)).toBe('LG_UNAVAILABLE');
});
