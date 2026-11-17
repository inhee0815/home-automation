import fs from 'fs';
import path from 'path';

const html = fs.readFileSync(path.join(__dirname,'../../public/index.html'),'utf8');

test('ON eligibility is driven by actual button state and excludes noncritical history failures',()=>{
  expect(html).toContain("const criticalWarnings=(data.warnings||[]).filter");
  expect(html).toContain("['TUYA_USAGE_UNAVAILABLE','BLOBS_STORE_UNAVAILABLE']");
  expect(html).toContain("const eligible=Boolean(data.canArmFromDashboard) && criticalWarnings.length===0");
  expect(html).toContain("$('switchOn').disabled=data.controlMode==='DEPLOY' || !eligible");
  expect(html).not.toContain("disabled=!data.canArmFromDashboard || data.partialData");
});

test('refresh or failed request leaves controls disabled until authenticated data arrives',()=>{
  expect(html).toContain("$('refresh').disabled=true;$('switchOn').disabled=true;$('switchOff').disabled=true");
  expect(html).toContain("set('switchFeedback','운영 상태 조회 실패 · ON 버튼 비활성화')");
});

test('dashboard displays persistence proof and never enables deploy-only controls',()=>{
 expect(html).toContain('id="storageState"');
 expect(html).toContain('id="readiness"');
 expect(html).toContain("data.controlMode==='DEPLOY' || !eligible");
 expect(html).toContain("set('storageAt',date(storage.latestRunAt))");
});

test('manual live test buttons are enabled only after authenticated eligibility',()=>{
 expect(html).toContain('id="testStatus" disabled');
 expect(html).toContain('id="testOn" disabled');
 expect(html).toContain('id="testOff" disabled');
 expect(html).toContain("$('testStatus').disabled=!data.manualLiveTestEnabled");
 expect(html).toContain("if(action!=='status' && !confirm");
});

test('token persists only after authenticated success when user opts in',()=>{
 expect(html).toContain("const REMEMBER_KEY='hood_dashboard_remembered_token'");
 expect(html).toContain("const SESSION_KEY='hood_dashboard_session_token'");
 expect(html).toContain("if($('remember').checked)");
 expect(html).toContain("storageSet(localStorage,REMEMBER_KEY,key)");
 expect(html).toContain("storageSet(sessionStorage,SESSION_KEY,key)");
});
test('logout clears persistent and session tokens',()=>{
 expect(html).toContain("storageRemove(localStorage,REMEMBER_KEY);storageRemove(sessionStorage,SESSION_KEY)");
 expect(html).toContain("if(key)$('refresh').click()");
});

test('restored login executes page script and immediately attempts authenticated refresh',async()=>{
 const {runInNewContext}=require('node:vm');
 const script=html.split('<script>')[1]?.split('</script>')[0];
 expect(script).toBeTruthy();
 const controls=new Map<string,any>();
 const el=(id:string)=>{
   if(!controls.has(id))controls.set(id,{
     value:'',checked:false,disabled:false,textContent:'',
     click(){if(typeof this.onclick==='function')return this.onclick();},
     replaceChildren(){},append(){},
   });
   return controls.get(id);
 };
 const storage=(entries:Record<string,string>={})=>{
   const data=new Map(Object.entries(entries));
   return {getItem:(k:string)=>data.get(k)||null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)};
 };
 const localStorage=storage({hood_dashboard_remembered_token:'stored-test-token'});
 const sessionStorage=storage();
 const fetch=jest.fn().mockResolvedValue({ok:false,status:401,json:async()=>({error:'Unauthorized'})});
 const document={getElementById:el,createElement:()=>({append(){},textContent:'',colSpan:0})};
 expect(()=>runInNewContext(script!,{document,localStorage,sessionStorage,fetch,confirm:()=>false,console})).not.toThrow();
 expect(el('remember').checked).toBe(true);
 expect(fetch).toHaveBeenCalledWith('/api/monitor-status',expect.objectContaining({
   headers:{'x-automation-token':'stored-test-token'},
 }));
});

test('operations overview shows clear state and distinguishes cache from observed status',()=>{
 expect(html).toContain('id="summaryHero"');
 expect(html).toContain('id="summaryTitle"');
 expect(html).toContain('id="summaryText"');
 expect(html).toContain('OFF로 기록됐지만 실제 확인은 아니에요');
 expect(html).toContain('설정된 지연 시간이 지난 뒤 다음 예약 실행에서 OFF를 시도합니다.');
});
test('recent events and detailed logs have distinct roles and filters',()=>{
 expect(html).toContain('id="eventTimeline"');
 expect(html).toContain('id="historyDetail"');
 expect(html).toContain('id="filterChanges"');
 expect(html).toContain('id="filterErrors"');
 expect(html).toContain("function renderHistory()");
 expect(html).toContain("renderHistory();renderTimeline(data);renderSummary(data);");
});
