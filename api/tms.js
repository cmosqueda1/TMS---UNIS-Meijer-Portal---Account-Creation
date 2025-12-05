// =====================================================
// api/tms.js
// STABLE VERSION + LOCATION CONTACT ADD LOGIC
// FIXES ERROR -15 LOGIN ISSUE
// =====================================================

const TMS_LOGIN_URL = "https://tms.freightapp.com/write/check_login.php";
const TMS_CREATE_USER_URL = "https://tms.freightapp.com/write_new/write_company_user.php";
const TMS_CONTACT_URL = "https://tms.freightapp.com/write_new/write_location_contacts_admin.php";
const TMS_PRO_LOOKUP_URL = "https://tms.freightapp.com/write/get_tms_pu_order_pro.php";
const TMS_ORDER_DETAIL_URL = "https://tms.freightapp.com/write/get_load_tms_orderv2.php";

const {
  TMS_USERNAME,
  TMS_PASSWORD_BASE64
} = process.env;

/* =====================================================
       SAFE POST WRAPPER
===================================================== */
async function safePost(url, body) {

  const r = await fetch(url, {
    method: "POST",
    headers:{
      "Content-Type":"application/x-www-form-urlencoded",
      "X-Requested-With":"XMLHttpRequest"
    },
    body
  });

  const text = await r.text();

  try { return JSON.parse(text); }
  catch { return { _invalid:true, raw:text }; }

}

/* =====================================================
       LOGIN
===================================================== */

async function tmsLogin(){

  const payload =
    `username=${TMS_USERNAME}` +
    `&password=${TMS_PASSWORD_BASE64}` +
    `&UserID=null` +
    `&UserToken=null` +
    `&pageName=/index.html`;

  return safePost(TMS_LOGIN_URL, payload);
}

/* =====================================================
       MAIN HANDLER
===================================================== */

export default async function handler(req,res){

  try{

    const { first_name, last_name, email, pro } = req.body;

    if(!first_name || !last_name || !email || !pro){
      return res.json({ error:"Missing required inputs" });
    }

    /* LOGIN */
    const login = await tmsLogin();

    if(!login?.UserID || !login?.UserToken){
      return res.json({
        error:"TMS login failed",
        debug: login
      });
    }

    const session = {
      UserID: login.UserID,
      UserToken: login.UserToken
    };

    /* LOOKUP PRO */
    const proLookup = await safePost(
      TMS_PRO_LOOKUP_URL,
      `pro=${pro}&UserID=${session.UserID}&UserToken=${session.UserToken}&pageName=dashboard`
    );

    const orderId = proLookup?.order?.tms_order_id;

    if(!orderId){
      return res.json({ error:"Invalid PRO", debug: proLookup });
    }

    const order = await safePost(
      TMS_ORDER_DETAIL_URL,
      `input_order_id=${orderId}&UserID=${session.UserID}&UserToken=${session.UserToken}&pageName=dashboard`
    );

    const vendorLocation = order?.order?.fk_client_id;

    if(!vendorLocation){
      return res.json({ error:"Vendor location not resolved", debug: order });
    }

    /* CREATE USER */
    const createUser = await safePost(
      TMS_CREATE_USER_URL,
      `input_user_id=0`+
      `&input_email=${email}`+
      `&input_username=${email}`+
      `&input_firstname=${first_name}`+
      `&input_lastname=${last_name}`+
      `&input_group=104`+
      `&input_project=0`+
      `&input_active=1`+
      `&use_sso_login=0`+
      `&input_safety=0&input_watch=0&input_driver=0&input_tablet=0`+
      `&input_bypass=0&input_maintenance=0`+
      `&input_timezone=PST`+
      `&input_user_type=0`+
      `&input_employee=0`+
      `&input_warehouse_user=407987`+
      `&input_text_notification=0&input_email_notification=0&input_app_notification=0`+
      `&input_eld_support=0&input_is_vendor=0&input_claims_access=0`+
      `&input_token_expire=0&input_multi_login=0`+
      `&input_terminal_permission=[]`+
      `&UserID=${session.UserID}`+
      `&UserToken=${session.UserToken}`+
      `&pageName=dashboardUserManager`
    );

    if(!createUser?.user_id){
      return res.json({ error:"Account creation failed", debug:createUser });
    }

    const userId = createUser.user_id;

    /* ADD LOCATION CONTACTS */
    const addContact = async (locationId)=>
      safePost(
        TMS_CONTACT_URL,
        `input_location_contacts_id=0`+
        `&input_fk_user_id=${userId}`+
        `&input_location_contacts_name=${first_name}`+
        `&input_location_contacts_lastname=${last_name}`+
        `&input_location_contacts_title=`+
        `&input_location_contacts_phone=`+
        `&input_location_contacts_fax=`+
        `&input_location_contacts_email=`+
        `&input_location_contacts_type=CSR`+
        `&input_fk_location_id=${locationId}`+
        `&input_contacts_notify_email=0`+
        `&input_contacts_notify_phone=0`+
        `&input_contacts_notify_text=0`+
        `&input_contacts_notify_fax=0`+
        `&input_location_contacts_status=1`+
        `&input_is_user_manager=1`+
        `&UserID=${session.UserID}`+
        `&UserToken=${session.UserToken}`+
        `&pageName=dashboardUserManager`
      );

    const vendorContact = await addContact(vendorLocation);
    const meijerContact = await addContact("407987");

    /* SUCCESS */
    return res.json({
      success:true,
      user_id:userId,
      username:createUser.user_email,
      password:createUser.password || "(not returned)",
      vendor_location:vendorLocation,
      meijer_location:"407987",
      contacts:{
        vendor: vendorContact?.location_contacts_id,
        meijer: meijerContact?.location_contacts_id
      }
    });

  }
  catch(err){
    return res.json({
      error:"Fatal backend exception",
      detail:err.message || err
    });
  }

}
