const ALLOW_PUBLIC = new Set([
  "getState","getLGAs","getWards","getPollingUnits","getMasterStatus","submitCoordinator"
]);
const ALLOW_ADMIN = new Set([
  "adminLogin","getDashboardStats","getMasterStatus","listRecords","exportRecords",
  "validateMasterList","buildMasterList","importGeographyCsv"
]);

async function sign(payload, secret){
  const data = new TextEncoder().encode(payload);
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig = await crypto.subtle.sign("HMAC",key,data);
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}
async function token(secret){
  const exp=Date.now()+60*60*1000;
  const body=`${exp}`;
  return `${body}.${await sign(body,secret)}`;
}
async function validToken(t,secret){
  try{
    const [exp,sig]=String(t||"").split(".");
    if(!exp||Number(exp)<Date.now())return false;
    return sig===await sign(exp,secret);
  }catch{return false}
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json;charset=UTF-8","cache-control":"no-store"}})}
export async function onRequest(context){
  const {request,env}=context;
  const backend=env.TK27_APPS_SCRIPT_URL;
  const secret=env.TK27_ADMIN_KEY;
  if(!backend||!secret)return json({success:false,error:{code:"CONFIG","message":"Server is not configured."}},500);
  const url=new URL(request.url), action=url.searchParams.get("action")||"";
  if(request.method==="OPTIONS")return new Response("",{status:204});
  if(action==="adminLogin" && request.method==="POST"){
    const body=await request.json().catch(()=>({}));
    if(!body.adminKey || body.adminKey!==secret)return json({success:false,error:{code:"UNAUTHORIZED","message":"Invalid admin key."}},401);
    return json({success:true,data:{session:await token(secret)}});
  }
  const isAdmin=ALLOW_ADMIN.has(action)&&action!=="adminLogin";
  if(!ALLOW_PUBLIC.has(action)&&!isAdmin)return json({success:false,error:{code:"NOT_FOUND","message":"Unknown action."}},404);
  if(isAdmin && !(await validToken(request.headers.get("X-Admin-Session"),secret)))
    return json({success:false,error:{code:"UNAUTHORIZED","message":"Admin session expired or invalid."}},401);

  const target=new URL(backend);
  target.searchParams.set("action",action);
  if(isAdmin)target.searchParams.set("adminKey",secret);
  let init={method:request.method,headers:{"content-type":"application/json"}};
  if(request.method==="POST")init.body=await request.text();
  try{
    const r=await fetch(target.toString(),init);
    const text=await r.text();
    return new Response(text,{status:r.status,headers:{"content-type":"application/json;charset=UTF-8","cache-control":"no-store"}});
  }catch(e){return json({success:false,error:{code:"BACKEND_UNAVAILABLE",message:"Backend is temporarily unavailable."}},502)}
}
