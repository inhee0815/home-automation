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
