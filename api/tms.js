import fetch from "node-fetch";

/*
 REQUIRED ENV VARIABLES
 -----------------------
 TMS_USER=<username>
 TMS_PASS_BASE64=<base64 password>
*/

const TMS_USER = process.env.TMS_USER;
const TMS_PASS = process.env.TMS_PASS_BASE64;

// =====================================================
// MAIN SERVERLESS HANDLER
// =====================================================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).json({ reply: "Invalid request method." });
    return;
  }

  try {
    const input = req.body?.text || "";
    const user = parseUserInput(input);

    if (!user.first_name || !user.last_name || !user.email)
      return res.status(200).json({ reply: missingFieldsMessage() });

    if (!user.po && !user.pro)
      return res.status(200).json({ reply: noPoProMessage() });

    const pros = user.pro || await poToProLookup(user.po);

    if (!pros)
      return res.status(200).json({
        reply:`The PO you provided - ${user.po} could not be found\n\n---\n\n${missingFieldsForm()}`
      });

    const session = await loginTMS();
    if (!session)
      return res.status(200).json({ reply: "❌ Unable to login to TMS." });

    const foundUser = await searchUser(session, user.email);

    if (foundUser) {
      const loc = await addLocations(session, foundUser.user_id, user, pros.location_id || "407987");
      return res.status(200).json({ reply: buildExistingReply(user.email, loc) });
    }

    const created = await createUser(session, user);

    if (!created.success)
      return res.status(200).json({ reply: created.message });

    const loc = await addLocations(session, created.user_id, user, pros.location_id || "407987");

    return res.status(200).json({
      reply: buildCreatedReply(user.email, created.password, loc)
    });

  } catch (err) {
    console.error("HANDLER FAILURE:", err);
    return res.status(200).json({
      reply: "❌ Server-side failure\n\n" + (err.message || String(err))
    });
  }
}

// =====================================================
// SAFE JSON PARSER — STOPS “Unexpected token” CRASHES
// =====================================================
async function safeJson(res){
  const text = await res.text();
  try{
    return JSON.parse(text);
  }catch{
    console.error("NON-JSON RESPONSE:\n", text.slice(0,500));
    return { _invalid:true, _raw:text };
  }
}

// =====================================================
// INPUT PARSER
// =====================================================
function parseUserInput(txt){
  const get = k => {
    const m = txt.match(new RegExp(`${k}-(.+)`, "i"));
    return m ? m[1].trim() : "";
  };

  return {
    first_name: get("first_name"),
    last_name:  get("last_name"),
    email:      get("email").toLowerCase(),
    po:         get("po"),
    pro:        get("pro")
  };
}

// =====================================================
function missingFieldsForm(){
  return `first_name-
last_name-
email-
po-
pro-`;
}

function missingFieldsMessage(){
  return `You must provide a first name, last name, and email\n\n---\n\n${missingFieldsForm()}`;
}

function noPoProMessage(){
  return `❌ No PO or PRO provided.\n\nYou may need to add vendor locations manually.`;
}

// =====================================================
// PO → PRO LOOKUP (Stub placeholder)
// =====================================================
async function poToProLookup(po){
  if(!po) return null;
  return {
    location_id:""
  };
}

// =====================================================
// TMS AUTH
// =====================================================
async function loginTMS(){
  const payload = new URLSearchParams({
    username:TMS_USER,
    password:TMS_PASS,
    UserID:"null",
    UserToken:"null",
    pageName:"/index.html"
  });

  const r = await fetch("https://tms.freightapp.com/write/check_login.php",{
    method:"POST",
    headers:{
      "Content-Type":"application/x-www-form-urlencoded",
      "X-Requested-With":"XMLHttpRequest"
    },
    body:payload
  });

  const j = await safeJson(r);

  if(!j.UserID || !j.UserToken) return null;

  return {
    UserID:j.UserID,
    UserToken:j.UserToken
  };
}

// =====================================================
// SEARCH EXISTING USER
// =====================================================
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

  if(j._invalid) return null;

  const users = Array.isArray(j) ? j : (j.users || []);
  return users.find(u => (u.user_email||"").toLowerCase() === email) || null;
}

// =====================================================
// CREATE USER
// =====================================================
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
    headers:{
      "Content-Type":"application/x-www-form-urlencoded",
      "X-Requested-With":"XMLHttpRequest"
    },
    body:payload
  });

  const j = await safeJson(r);

  if(j._invalid){
    return { success:false, message:"❌ Invalid response from TMS during user creation." };
  }

  return {
    success:true,
    user_id:j.user_id,
    password:j.password || j.temp_password || "(not returned)"
  };
}

// =====================================================
// ASSIGN LOCATIONS
// =====================================================
async function addLocations(session,user_id,user,loc){

  async function add(id){
    const payload = new URLSearchParams({
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

    await fetch("https://tms.freightapp.com/write_new/write_location_contacts_admin.php",{
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        "X-Requested-With":"XMLHttpRequest"
      },
      body:payload
    });
  }

  await add(loc || "407987");  // Vendor
  await add("407987");         // Meijer

  return {
    dynamic: loc || "407987",
    meijer: "407987"
  };
}

// =====================================================
// OUTPUT TEXT BUILDERS
// =====================================================
function buildCreatedReply(username,password,loc){
  return `✅ Account Created → Location contact(s) added.

Vendor Location ID:
${loc.dynamic}

Meijer Location ID:
${loc.meijer}

---

https://ship.unisco.com/v2/index.html#/login

Username:
${username}

Password:
${password}`;
}

function buildExistingReply(username,loc){
  return `✅ Account already exists → Location contact(s) added.

Vendor Location ID:
${loc.dynamic}

Meijer Location ID:
${loc.meijer}

---

https://ship.unisco.com/v2/index.html#/login

Username:
${username}`;
}
