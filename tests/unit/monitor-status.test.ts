jest.mock('@netlify/blobs',()=>({getStore:jest.fn()}));
import {getStore} from '@netlify/blobs';
import {handler} from '../../netlify/functions/monitor-status';
const store={get:jest.fn(),list:jest.fn()};
const run=async(header?:string)=>{
  const response=await handler({httpMethod:'GET',headers:header?{'x-automation-token':header}:{}} as any,{} as any);
  return response as any;
};
beforeEach(()=>{
 jest.clearAllMocks();(getStore as jest.Mock).mockReturnValue(store);
 process.env.AUTOMATION_ADMIN_TOKEN='test-admin';
 delete process.env.AUTOMATION_ENABLED;
 store.get.mockResolvedValue(null);store.list.mockResolvedValue({blobs:[]});
});
test('fails closed without configured administrator token',async()=>{
 delete process.env.AUTOMATION_ADMIN_TOKEN;
 expect((await run('test-admin')).statusCode).toBe(503);
});
test('rejects requests with missing or invalid token',async()=>{
 expect((await run()).statusCode).toBe(401);
 expect((await run('wrong')).statusCode).toBe(401);
 expect(store.get).not.toHaveBeenCalled();
});
test('serves paused status without accessing Tuya or LG endpoints',async()=>{
 const response=await run('test-admin');
 expect(response.statusCode).toBe(200);
 const obj=JSON.parse(response.body);
 expect(obj.status).toBe('PAUSED');
 expect(obj.tuya.attempts).toBe(0);
});
