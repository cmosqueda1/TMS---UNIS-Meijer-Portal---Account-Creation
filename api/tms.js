// /api/tms.js
import fetch from "node-fetch";

// ================= CONFIG =================
//
// Replace with real values via ENV variables:
//
const TMS_USER = process.env.TMS_USER;            // cmosqueda
const TMS_PASS = process.env.TMS_PASS_BASE64;    // UWF2NjUyODk=
//
// ==========================================


export default async function handler(req,res){

  if(req.method!=="POST"){
    res.status(405).end();
    return;
  }

  try{
    const text = req.body.text || "";
    const user = parseUserInput(text);

    // ---- Required fields validation ----
    if(!user.first_name || !user.last_name || !user.email){
      return res.json({reply: missingFieldsMessage()});
    }

    if(!user.po && !user.pro){
      return res.json({reply:noPoProMessage()});
    }

    // ---- PO → PRO translation if needed ----
    let pros = user.pro ? user.pro : await poToProLookup(user.po);
    if(!pros){
      return res.json({
        reply:`The PO you provided - ${user.po} could not be found\n\n---\n\n${missingFieldsForm()}`
      });
    }

    // ---- Login to TMS ----
    const session = await loginTMS();

    if(!session){
      return res.json({reply:"❌ Unable to login to TMS."});
    }

    // ---- Search existing user ----
    const foundUser = await searchUser(session, user.email);

    if(!foundUser){
      // Create user
      var creationResult = await createUser(session, user);
      if(!creationResult.success){
        return res.json({ reply: creationResult.message });
      }

      // Add location contacts
      const locResult = await addLocations(
        session,
        creationResult.user_id,
        creationResult.first,
        creationResult.last,
        user.email,
        pros.location_id || "407987"
      );

      return res.json({
        reply: buildCreatedReply(user.email, creationResult.password, locResult)
      });

    } else {
      // User exists
      const locResult = await addLocations(
        session,
        foundUser.user_id,
        foundUser.first,
        foundUser.last,
        user.email,
        pros.location_id || "407987"
      );

      return res.json({
        reply: buildExistingReply(user.email, locResult)
      });
    }

  }catch(err){
    console.error("TMS ERROR:",err);
    res.json({ reply: "❌ Internal Error: " + err.message });
  }
}


// ============================================================
// RESULT TEMPLATES
// ============================================================

function buildCreatedReply(username,password,loc){
  return `✅ Account Created → Location contact(s) added.

Vendor Location ID-
${loc.dynamic}

Meijer Location ID-
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

Vendor Location ID-
${loc.dynamic}

Meijer Location ID-
${loc.meijer}

---

https://ship.unisco.com/v2/index.html#/login

Username:
${username}`;
}


// ============================================================
// INPUT PARSER
// ============================================================

function parseUserInput(text){

  const get = (label)=>{
    const m = text.match(new RegExp(label+"-(.+)","i"));
    return m ? m[1].trim() : "";
  };

  return {
    first_name: get("first_name"),
    last_name: get("last_name"),
    email: get("email").toLowerCase(),
    po: get("po"),
    pro: get("pro")
  };
}

// ============================================================
// MESSAGES
// ============================================================

function missingFieldsForm(){
  return `first_name-
last_name-
email-
po-
pro-`;
}

function missingFieldsMessage(){
  return `You must provide a first name, last name, and email

---

Please copy and complete:

${missingFieldsForm()}`;
}

function noPoProMessage(){
  return `❌ No PO/PRO provided

- You may need to add vendor locations manually`;
}


// ============================================================
// PO → PRO LOOKUP (Stub Hook – matches your DSL flow)
// Replace body with your scraping or API logic if needed.
// ============================================================

async function poToProLookup(po){
  if(!po) return null;
  return {
    text: "",
    location_id: ""
  };
}


// ============================================================
// TMS API FUNCTIONS
// ============================================================

async function loginTMS(){

  const params = new URLSearchParams({
    username: TMS_USER,
    password: TMS_PASS,
    UserID:"null",
    UserToken:"null",
    pageName:"/index.html"
  });

  const r = await fetch("https://tms.freightapp.com/write/check_login.php",{
    method:"POST",
    headers:{
      "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With":"XMLHttpRequest"
    },
    body: params
  });

  const j = await r.json();
  if(!j.UserID || !j.UserToken) return null;

  return {
    UserID: j.UserID,
    UserToken: j.UserToken
  };
}


async function searchUser(session,email){

  const params = new URLSearchParams({
    input_email: email,
    input_group: "0",
    UserID: session.UserID,
    UserToken: session.UserToken,
    pageName:"dashboardUserManager"
  });

  const r = await fetch("https://tms.freightapp.com/write_new/search_group_users.php",{
    method:"POST",
    body: params
  });

  const j = await r.json();

  const users = Array.isArray(j) ? j : j.users || [];

  return users.find(u =>
    u.user_email?.toLowerCase().trim() === email
  ) || null;
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
    headers:{
      "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With":"XMLHttpRequest"
    },
    body: payload
  });

  const j = await r.json();

  return {
    success:true,
    user_id: j.user_id || "",
    password: j.password || j.temp_password || "Password not provided",
    first: user.first_name,
    last: user.last_name
  };
}


async function addLocations(session,user_id,first,last,email,location_id){

  const add = async (loc)=>{

    const payload = new URLSearchParams({
      input_location_contacts_id:0,
      input_fk_user_id:user_id,
      input_location_contacts_name:first,
      input_location_contacts_lastname:last,
      input_location_contacts_email:email,
      input_location_contacts_type:"CSR",
      input_fk_location_id:loc,

      input_location_contacts_status:1,
      input_is_user_manager:1,

      UserID:session.UserID,
      UserToken:session.UserToken,
      pageName:"dashboardUserManager"
    });

    await fetch("https://tms.freightapp.com/write_new/write_location_contacts_admin.php",{
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With":"XMLHttpRequest"
      },
      body: payload
    });
  };

  // Dynamic + Meijer hardcoded
  await add(location_id || "407987");
  await add("407987");

  return {
    dynamic: location_id || "407987",
    meijer: "407987"
  };
}
