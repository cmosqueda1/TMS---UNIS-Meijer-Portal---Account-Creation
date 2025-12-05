/*
  =============================================
  CRASH-PROOF MEIJER TMS BOT API
  =============================================

  REQUIRED ENV VARS:

  TMS_USER=<username>
  TMS_PASS_BASE64=<base64_password>

  Node 18+ (Vercel native fetch)
*/

export default async function handler(req, res) {
  try {

    // Body safety guard
    let inputText = "";
    if (req.body && typeof req.body === "object") {
      inputText = req.body.text || "";
    }

    const user = parseUserInput(inputText);

    if (!user.first_name || !user.last_name || !user.email) {
      return res.status(200).json({ reply: missingFieldsMessage() });
    }

    if (!user.po && !user.pro) {
      return res.status(200).json({ reply: noPoProMessage() });
    }

    // PO→PRO lookup hook (stub)
    const proLookup = user.pro ? { location_id: "" } : await poToProLookup(user.po);
    if (!proLookup) {
      return res.status(200).json({
        reply: `The PO you provided - ${user.po} could not be found\n\n---\n\n${missingFieldsForm()}`
      });
    }

    const session = await loginTMS();
    if (!session) {
      return res.status(200).json({ reply: "❌ Unable to authenticate to TMS" });
    }

    const existingUser = await searchUser(session, user.email);

    if (!existingUser) {
      const created = await createUser(session, user);
      if (!created.success) return res.status(200).json({ reply: created.message });

      const loc = await addLocations(session, created.user_id, user, proLookup.location_id || "407987");

      return res.status(200).json({
        reply: buildCreatedReply(user.email, created.password, loc)
      });
    }

    const loc = await addLocations(session, existingUser.user_id, user, proLookup.location_id || "407987");

    return res.status(200).json({
      reply: buildExistingReply(user.email, loc)
    });

  } catch (err) {

    console.error("FATAL API ERROR:", err);

    // ABSOLUTE GUARANTEE: JSON ALWAYS RETURNED
    return res.status(200).json({
      reply: "❌ Server-side crash intercepted:\n\n" + (err.message || String(err))
    });
  }
}

/* =================================================
                UTILITIES
==================================================*/

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("NON JSON RESPONSE:", text.slice(0,400));
    return { _invalid:true,_raw:text };
  }
}

function parseUserInput(txt){
  const grab=k=>{
    const m=txt.match(new RegExp(k+"-(.+)","i"));
    return m?m[1].trim():"";
  }
  return {
    first_name: grab("first_name"),
    last_name: grab("last_name"),
    email: grab("email").toLowerCase(),
    po: grab("po"),
    pro: grab("pro")
  };
}

function missingFieldsForm(){
  return `first_name-
last_name-
email-
po-
pro-`;
}
function missingFieldsMessage(){
  return `You must provide first name, last name, and email\n\n---\n\n${missingFieldsForm()}`;
}
function noPoProMessage(){
  return `❌ No PO or PRO provided.\n\nAdd vendor locations manually if needed.`;
}

async function poToProLookup(){ return { location_id:"" }; }

/* =================================================
                TMS FUNCTIONS
==================================================*/

async function loginTMS() {

  const payload = new URLSearchParams({
    username: process.env.TMS_USER,
    password: process.env.TMS_PASS_BASE64,
    UserID:"null",
    UserToken:"null",
    pageName:"/index.html"
  });

  const r = await fetch(
    "https://tms.freightapp.com/write/check_login.php",
    {
      method:"POST",
      headers:{ "Content-Type":"application/x-www-form-urlencoded","X-Requested-With":"XMLHttpRequest"},
      body:payload
    }
  );

  const j = await safeJson(r);

  if (!j.UserID || !j.UserToken) return null;

  return { UserID:j.UserID, UserToken:j.UserToken };
}

async function searchUser(session,email){

  const payload = new URLSearchParams({
    input_email: email,
    input_group:"0",
    UserID:session.UserID,
    UserToken:session.UserToken,
    pageName:"dashboardUserManager"
  });

  const r = await fetch("https://tms.freightapp.com/write_new/search_group_users.php",{
    method:"POST",
    body:payload
  });

  const j = await safeJson(r);
  const list = Array.isArray(j)?j:(j.users||[]);

  return list.find(u => (u.user_email||"").toLowerCase()===email) || null;
}

async function createUser(session,user){

  const payload = new URLSearchParams({
    input_user_id:0,
    input_email:user.email,
    input_username:user.email,
    input_firstname:user.first_name,
    input_lastname:user.last_name,
    input_group:1071,
    input_active:1,
    input_is_vendor:1,
    input_timezone:"PST",
    input_warehouse_user:407987,
    UserID:session.UserID,
    UserToken:session.UserToken,
    pageName:"dashboardUserManager"
  });

  const r = await fetch("https://tms.freightapp.com/write_new/write_company_user.php",{
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded","X-Requested-With":"XMLHttpRequest"},
    body:payload
  });

  const j = await safeJson(r);
  if(j._invalid) return { success:false, message:"❌ TMS creation returned invalid response" };

  return {
    success:true,
    user_id:j.user_id,
    password:j.password||j.temp_password||"(not returned)"
  };
}

async function addLocations(session,user_id,user,loc){

  async function add(id){
    const payload=new URLSearchParams({
      input_location_contacts_id:0,
      input_fk_user_id:user_id,
      input_location_contacts_name:user.first_name,
      input_location_contacts_lastname:user.last_name,
      input_location_contacts_email:user.email,
      input_location_contacts_type:"CSR",
      input_fk_location_id:id,
      input_location_contacts_status:1,
      input_is_user_manager:1,
      UserID:session.UserID,
      UserToken:session.UserToken,
      pageName:"dashboardUserManager"
    });

    await fetch("https://tms.freightapp.com/write_new/write_location_contacts_admin.php",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","X-Requested-With":"XMLHttpRequest"},body:payload});
  }

  await add(loc||"407987");
  await add("407987");

  return { dynamic:loc||"407987", meijer:"407987" };
}

/* =================================================
                OUTPUT TEMPLATES
==================================================*/

function buildCreatedReply(username,password,loc){
  return `✅ Account Created → Location contact(s) added.

Vendor Location:
${loc.dynamic}

Meijer Location:
${loc.meijer}

---
https://ship.unisco.com/v2/index.html#/login

Username:
${username}

Password:
${password}`;
}

function buildExistingReply(username,loc){
  return `✅ Account Already Exists → Locations updated.

Vendor Location:
${loc.dynamic}

Meijer Location:
${loc.meijer}

---
https://ship.unisco.com/v2/index.html#/login

Username:
${username}`;
}
