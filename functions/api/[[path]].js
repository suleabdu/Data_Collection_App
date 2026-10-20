export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const upstream = env.TK27_APPS_SCRIPT_URL;
  if (!upstream) return json({success:false,error:{code:"CONFIG_ERROR",message:"Backend URL is not configured."}},500);

  if (request.method === "OPTIONS") return cors(new Response(null,{status:204}));

  const action = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  const allowedGet = new Set(["health","state","lgas","wards","polling-units","master-status"]);
  const allowedPost = new Set(["submit","admin/login","admin/status","admin/records","admin/validate-master","admin/refresh-master","admin/logout"]);

  try {
    let target = new URL(upstream);
    if (request.method === "GET") {
      const map = {health:"health",state:"getState",lgas:"getLGAs","wards":"getWards", "polling-units":"getPollingUnits","master-status":"getMasterStatus"};
      if (!allowedGet.has(action)) return json({success:false,error:{code:"NOT_FOUND",message:"Unknown endpoint."}},404);
      target.searchParams.set("action",map[action]);
      for (const [k,v] of url.searchParams.entries()) {
        if (k !== "action") target.searchParams.set(k,v);
      }
      const r = await fetch(target.toString(), {method:"GET",redirect:"follow"});
      return cors(await cloneJson(r));
    }

    if (request.method !== "POST") return json({success:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed."}},405);
    if (!allowedPost.has(action)) return json({success:false,error:{code:"NOT_FOUND",message:"Unknown endpoint."}},404);

    const body = await request.json();
    const actionMap = {
      "submit":"submitCoordinator",
      "admin/login":"adminLogin",
      "admin/status":"adminStatus",
      "admin/records":"adminRecords",
      "admin/validate-master":"adminValidateMaster",
      "admin/refresh-master":"adminRefreshMaster",
      "admin/logout":"adminLogout"
    };
    body.action = actionMap[action];

    const r = await fetch(target.toString(), {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body),
      redirect:"follow"
    });
    return cors(await cloneJson(r));
  } catch (e) {
    return json({success:false,error:{code:"UPSTREAM_ERROR",message:"The backend could not be reached."}},502);
  }
}

async function cloneJson(response) {
  const text = await response.text();
  return new Response(text,{status:response.status,headers:{"Content-Type":"application/json"}});
}
function cors(response) {
  const h = new Headers(response.headers);
  h.set("Access-Control-Allow-Origin","*");
  h.set("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers","Content-Type");
  h.set("Cache-Control","no-store");
  return new Response(response.body,{status:response.status,headers:h});
}
function json(obj,status=200) {
  return cors(new Response(JSON.stringify(obj),{status,headers:{"Content-Type":"application/json"}}));
}
