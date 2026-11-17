export type TuyaFailureKind='LOCAL_QUOTA'|'AUTH'|'OFFLINE'|'RATE_LIMIT'|'TIMEOUT'|'NETWORK'|'REJECTED'|'UNKNOWN';
export function classifyTuyaFailure(error:unknown):TuyaFailureKind{
 const e=error as {message?:string;code?:string;response?:{status?:number}}|null;
 const m=String(e?.message||'');
 if(/daily budget|quota guard|budget reached/i.test(m))return 'LOCAL_QUOTA';
 if(/offline/i.test(m))return 'OFFLINE';
 if(e?.response?.status===401||e?.response?.status===403||/credentials|token.*fail/i.test(m))return 'AUTH';
 if(e?.response?.status===429)return 'RATE_LIMIT';
 if(/timeout/i.test(m)||e?.code==='ETIMEDOUT'||e?.code==='ECONNABORTED')return 'TIMEOUT';
 if(['ECONNRESET','ENOTFOUND','ECONNREFUSED','EAI_AGAIN'].includes(String(e?.code)))return 'NETWORK';
 if(e?.response?.status && e.response.status>=400||/rejected/i.test(m))return 'REJECTED';
 return 'UNKNOWN';
}
