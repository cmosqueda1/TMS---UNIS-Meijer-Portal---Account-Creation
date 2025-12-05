// =====================================================
// api/tms.js
// REVERTED STABLE VERSION + LOCATION CONTACT ADD LOGIC
// =====================================================
// ✅ Uses your previously WORKING login + create flow
// ✅ No cookie/session changes
// ✅ No E2Open or PO changes
// ✅ Only adds missing contact creation step
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

export default async function handler(req, res) {

  try {

    const { first_name, last_name, email, pro } = req.body;

    if(!first_name || !last_name || !email || !pro){
      return res.json({
        error: "Missing required fields (first_name, last_name, email, pro)"
      });
    }

    /* ==================================================
        LOGIN (REVERTED - ORIGINAL WORKING METHOD)
    ================================================== */

    const loginResp = await safeFetch(
      TMS_LOGIN_URL,
      new URLSearchParams({
        username: TMS_USERNAME,
        password: TMS_PASSWORD_BASE64,
        UserID: "null",
        UserToken: "null",
        pageName: "/index.html"
      })
    );

    if(!loginResp?.UserID || !loginResp?.UserToken){
      return res.json({
        error: "TMS login failed",
        debug: loginResp
      });
    }

    const session = {
      UserID: loginResp.UserID,
      UserToken: loginResp.UserToken
    };

    /* ==================================================
        PRO → ORDER → VENDOR LOCATION
    ================================================== */

    const proLookup = await safeFetch(
      TMS_PRO_LOOKUP_URL,
      new URLSearchParams({
        pro,
        UserID: session.UserID,
        UserToken: session.UserToken,
        pageName: "dashboard"
      })
    );

    const orderId = proLookup?.order?.tms_order_id;

    if(!orderId){
      return res.json({
        error: "Invalid PRO - no order found",
        debug: proLookup
      });
    }

    const orderDetails = await safeFetch(
      TMS_ORDER_DETAIL_URL,
      new URLSearchParams({
        input_order_id: orderId,
        UserID: session.UserID,
        UserToken: session.UserToken,
        pageName: `dashboard_tms_order.php?order_id=${orderId}`
      })
    );

    const vendorLocation = orderDetails?.order?.fk_client_id;

    if(!vendorLocation){
      return res.json({
        error: "Vendor location not resolved",
        debug: orderDetails
      });
    }

    /* ==================================================
        CREATE USER (REVERTED HAR PAYLOAD)
    ================================================== */

    const createUser = await safeFetch(
      TMS_CREATE_USER_URL,
      new URLSearchParams({
        input_user_id: 0,
        input_email: email,
        input_username: email,
        input_firstname: first_name,
        input_lastname: last_name,

        input_group: 104,
        input_project: 0,
        input_active: 1,
        use_sso_login: 0,

        input_safety: 0,
        input_watch: 0,
        input_driver: 0,
        input_tablet: 0,
        input_bypass: 0,
        input_maintenance: 0,

        input_timezone: "PST",
        input_user_type: 0,
        input_employee: 0,
        input_warehouse_user: 407987,

        input_text_notification: 0,
        input_email_notification: 0,
        input_app_notification: 0,
        input_eld_support: 0,

        input_is_vendor: 0,
        input_claims_access: 0,
        input_token_expire: 0,
        input_multi_login: 0,

        input_terminal_permission: "[]",

        UserID: session.UserID,
        UserToken: session.UserToken,
        pageName: "dashboardUserManager"
      })
    );

    if(!createUser?.user_id){
      return res.json({
        error: "Account creation FAILED",
        debug: createUser
      });
    }

    const userId = createUser.user_id;

    /* ==================================================
        ADD LOCATION CONTACTS (NEW)
    ================================================== */

    const addContact = async (locationId) =>
      safeFetch(
        TMS_CONTACT_URL,
        new URLSearchParams({

          input_location_contacts_id: 0,
          input_fk_user_id: userId,

          input_location_contacts_name: first_name,
          input_location_contacts_lastname: last_name,
          input_location_contacts_title: "",
          input_location_contacts_phone: "",
          input_location_contacts_fax: "",
          input_location_contacts_email: "",
          input_location_contacts_type: "CSR",

          input_fk_location_id: locationId,

          input_contacts_notify_email: 0,
          input_contacts_notify_phone: 0,
          input_contacts_notify_text: 0,
          input_contacts_notify_fax: 0,

          input_location_contacts_status: 1,
          input_is_user_manager: 1,

          UserID: session.UserID,
          UserToken: session.UserToken,
          pageName: "dashboardUserManager"
        })
      );

    const vendorContactResult = await addContact(vendorLocation);
    const meijerContactResult = await addContact("407987");

    /* ==================================================
        SUCCESS
    ================================================== */

    return res.json({
      success: true,

      username: createUser.user_email,
      password: createUser.password || "(not returned)",
      user_id: userId,

      vendor_location_id: vendorLocation,
      meijer_location_id: "407987",

      contacts_added: {
        vendor: vendorContactResult?.location_contacts_id || "unknown",
        meijer: meijerContactResult?.location_contacts_id || "unknown"
      }
    });

  }
  catch (err) {

    return res.json({
      error: "Fatal backend error",
      details: err.message || err
    });

  }
}

/* ==================================================
        SAFE FETCH (NON-JSON SAFE)
================================================== */

async function safeFetch(url, body){

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":"application/x-www-form-urlencoded",
      "X-Requested-With":"XMLHttpRequest"
    },
    body
  });

  const text = await r.text();

  try {
    return JSON.parse(text);
  }
  catch {
    return {
      _invalid: true,
      raw: text
    };
  }

}
