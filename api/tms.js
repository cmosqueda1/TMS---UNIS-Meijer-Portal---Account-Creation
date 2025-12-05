// =====================================================
// api/tms.js - FINAL COOKIE-SAFE VERSION
// =====================================================
// ✅ Restores PHPSESSID session logic that your environment requires
// ✅ PO OR PRO input supported
// ✅ E2Open PO→PRO lookup
// ✅ PRO → Vendor Location via TMS
// ✅ HAR-correct user creation payload
// ✅ Adds BOTH vendor and Meijer contacts
// ✅ Handles non-JSON safely
// =====================================================

const TMS_LOGIN_URL  = "https://tms.freightapp.com/write/check_login.php";
const TMS_CREATE_URL= "https://tms.freightapp.com/write_new/write_company_user.php";
const TMS_CONTACT_URL ="https://tms.freightapp.com/write_new/write_location_contacts_admin.php";
const TMS_PRO_URL   = "https://tms.freightapp.com/write/get_tms_pu_order_pro.php";
const TMS_ORDER_URL= "https://tms.freightapp.com/write/get_load_tms_orderv2.php";

// ENV:
const {
  TMS_USERNAME,
  TMS_PASSWORD_BASE64,
  E2OPEN_TOKEN
} = process.env;

export default async function handler(req,res){
  try{
    if(req.method !== "POST"){
      return res.json({ error:"Method not allowed" });
    }

    const { first_name,last_name,email,pro,po }=req.body||{};

    if(!first_name||!last_name||!email){
      return res.json({ error:"Missing first or last name or email" });
    }
    if(!pro && !po){
      return res.json({ error:"You must submit either a PO or PRO" });
    }

    // =====================================================
    // ✅ LOGIN (SESSION COOKIE PRESERVED)
    // =====================================================
    const loginRes = await fetch(TMS_LOGIN_URL,{
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        "X-Requested-With":"XMLHttpRequest"
      },
      credentials:"include",
      body:new URLSearchParams({
        username:TMS_USERNAME,
        password:TMS_PASSWORD_BASE64,
        UserID:"null",
        UserToken:"null",
        pageName:"/index.html"
      })
    });

    const rawCookies = loginRes.headers.get("set-cookie") || "";
    const cookies = rawCookies.split(",")
      .map(x=>x.split(";")[0])
      .join("; ");

    const login = await safe(loginRes);

    if(!login?.UserID || !cookies){
      return res.json({
        error:"❌ TMS login failed",
        raw: login
      });
    }

    const sessionHeaders={
      "Content-Type":"application/x-www-form-urlencoded",
      "X-Requested-With":"XMLHttpRequest",
      cookie: cookies
    };

    const session={
      UserID:login.UserID,
      UserToken:login.UserToken,
      headers:sessionHeaders
    };

    // =====================================================
    // ✅ PO → PRO VIA E2OPEN
    // =====================================================
    let resolvedPRO=pro;

    if(!resolvedPRO && po){
      const e = await fetch(
        "https://api.e2open.com/logistics/v1/lookup/po",
        {
          headers:{
            Authorization:`Bearer ${E2OPEN_TOKEN}`,
            Accept:"application/json"
          }
        }
      );
      const j = await e.json();
      resolvedPRO = j?.shipments?.[0]?.pro;

      if(!resolvedPRO){
        return res.json({ error:`PO ${po} did not resolve to a PRO` });
      }
    }

    // =====================================================
    // ✅ PRO → ORDER → VENDOR LOCATION
    // =====================================================
    const lookup = await safe(fetch(
      TMS_PRO_URL,{
        method:"POST",
        headers:session.headers,
        body:new URLSearchParams({
          pro:resolvedPRO,
          UserID:session.UserID,
          UserToken:session.UserToken,
          pageName:"dashboard"
        })
      })
    );

    const orderId = lookup?.order?.tms_order_id;

    const detail = await safe(fetch(
      TMS_ORDER_URL,{
        method:"POST",
        headers:session.headers,
        body:new URLSearchParams({
          input_order_id:orderId,
          UserID:session.UserID,
          UserToken:session.UserToken,
          pageName:"dashboard"
        })
      })
    );

    const vendorLocation = detail?.order?.fk_client_id;

    if(!vendorLocation){
      return res.json({ error:"No vendor location resolved" });
    }

    // =====================================================
    // ✅ CREATE USER
    // =====================================================
    const create = await safe(fetch(
      TMS_CREATE_URL,{
        method:"POST",
        headers:session.headers,
        body:new URLSearchParams({
          input_user_id:0,
          input_email:email,
          input_username:email,
          input_firstname:first_name,
          input_lastname:last_name,
          input_group:104,
          input_project:0,
          input_active:1,
          use_sso_login:0,
          input_safety:0,
          input_watch:0,
          input_driver:0,
          input_tablet:0,
          input_bypass:0,
          input_maintenance:0,
          input_timezone:"PST",
          input_user_type:0,
          input_employee:0,
          input_warehouse_user:407987,
          input_text_notification:0,
          input_email_notification:0,
          input_app_notification:0,
          input_eld_support:0,
          input_is_vendor:0,
          input_claims_access:0,
          input_token_expire:0,
          input_multi_login:0,
          input_terminal_permission:"[]",
          UserID:session.UserID,
          UserToken:session.UserToken,
          pageName:"dashboardUserManager"
        })
      })
    );

    if(!create?.user_id){
      return res.json({ error:"Account creation failed", details:create });
    }

    const UID=create.user_id;

    // =====================================================
    // ✅ ADD BOTH LOCATION CONTACTS
    // =====================================================
    await addLocation(UID,vendorLocation,{first_name,last_name},session);
    await addLocation(UID,"407987",{first_name,last_name},session);

    // =====================================================
    // ✅ SUCCESS
    // =====================================================
    return res.json({
      success:true,
      username:create.user_email,
      password:create.password || "(not returned)",
      user_id:UID,
      resolved_pro:resolvedPRO,
      vendor_location_id:vendorLocation,
      meijer_location_id:"407987"
    });

  }catch(err){
    return res.json({ error:"Fatal backend error", details: err.message || err });
  }
}

/* =====================================================
   HELPERS
===================================================== */

async function safe(r){
  const t=await r.text();
  try{ return JSON.parse(t); }
  catch{ return {_invalid:true,raw:t}; }
}

async function addLocation(userId,locId,user,session){
  return safe(fetch(
    TMS_CONTACT_URL,{
      method:"POST",
      headers:session.headers,
      body:new URLSearchParams({
        input_location_contacts_id:0,
        input_fk_user_id:userId,
        input_location_contacts_name:user.first_name,
        input_location_contacts_lastname:user.last_name,
        input_location_contacts_title:"",
        input_location_contacts_phone:"",
        input_location_contacts_fax:"",
        input_location_contacts_email:"",
        input_location_contacts_type:"CSR",
        input_fk_location_id:locId,
        input_contacts_notify_email:0,
        input_contacts_notify_phone:0,
        input_contacts_notify_text:0,
        input_contacts_notify_fax:0,
        input_location_contacts_status:1,
        input_is_user_manager:1,
        UserID:session.UserID,
        UserToken:session.UserToken,
        pageName:"dashboardUserManager"
      })
    })
  );
}
