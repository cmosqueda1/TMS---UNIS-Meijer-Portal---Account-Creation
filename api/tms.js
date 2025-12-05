// api/tms.js
// =====================================================
// TMS Account Creation Bot - Production backend
// -----------------------------------------------------
// Fully matches confirmed HAR payload
// Separates Vendor Location (from PRO lookup)
// vs Meijer Location (fixed 407987)
// =====================================================

export default async function handler(req, res) {
  try {
    const { first_name, last_name, email, pro } = req.body || {};

    if (!first_name || !last_name || !email || !pro) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["first_name", "last_name", "email", "pro"]
      });
    }

    // ==================================================
    // LOGIN
    // ==================================================
    const loginResp = await fetch(
      "https://tms.freightapp.com/write/check_login.php",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: new URLSearchParams({
          username: "cmosqueda",
          password: "UWF2NjUyODk=",
          UserID: "null",
          UserToken: "null",
          pageName: "/index.html"
        })
      }
    );

    const loginJSON = await loginResp.json();

    if (!loginJSON?.UserID || !loginJSON?.UserToken) {
      return res.status(500).json({
        error: "TMS login failed",
        response: loginJSON
      });
    }

    const USER_ID = loginJSON.UserID;
    const USER_TOKEN = loginJSON.UserToken;

    // ==================================================
    // FIND VENDOR LOCATION BY PRO
    // ==================================================
    const proResp = await fetch(
      "https://tms.freightapp.com/write/get_tms_pu_order_pro.php",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: new URLSearchParams({
          pro,
          UserID: USER_ID,
          UserToken: USER_TOKEN,
          pageName: "/dashboard_tms_order.php"
        })
      }
    );

    const proJSON = await proResp.json();
    const orderId = proJSON?.order?.tms_order_id;

    if (!orderId) {
      return res.status(500).json({
        error: "PRO lookup failed",
        response: proJSON
      });
    }

    const detailResp = await fetch(
      "https://tms.freightapp.com/write/get_load_tms_orderv2.php",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: new URLSearchParams({
          input_order_id: orderId,
          UserID: USER_ID,
          UserToken: USER_TOKEN,
          pageName: `/dashboard_tms_order.php?order_id=${orderId}`
        })
      }
    );

    const detailJSON = await detailResp.json();

    const VENDOR_LOCATION_ID = detailJSON?.order?.fk_client_id;

    if (!VENDOR_LOCATION_ID) {
      return res.status(500).json({
        error: "No Vendor Location detected from PRO",
        response: detailJSON
      });
    }

    // ==================================================
    // CREATE USER
    // ==================================================
    const createPayload = new URLSearchParams({
      input_user_id: "0",
      input_email: email,
      input_username: email,
      input_firstname: first_name,
      input_lastname: last_name,
      input_group: "104",
      input_group_terminals: "undefined",
      input_mobile: "",
      input_dob: "",
      input_doh: "",
      input_dl_expiry: "",
      input_license: "undefined",
      input_license_mm: "undefined",
      input_license_dd: "undefined",
      input_license_yy: "undefined",
      input_warehouse_driver: "undefined",
      input_rv: "undefined",
      input_rv_code: "undefined",
      input_pay_type: "undefined",
      input_project: "0",
      input_pay_amount: "undefined",
      input_active: "1",
      use_sso_login: "0",
      use_sso_domain: "",
      input_safety: "0",
      input_watch: "0",
      input_driver: "0",
      input_tablet: "0",
      input_gp_code: "",
      input_ext_code: "",
      input_bypass: "0",
      input_maintenance: "0",
      input_timezone: "PST",
      input_user_type: "0",
      input_developer_ftp: "",
      input_employee: "0",
      input_warehouse_user: "407987",
      input_text_notification: "0",
      input_email_notification: "0",
      input_app_notification: "0",
      input_eld_support: "0",
      input_is_vendor: "0",
      input_claims_access: "0",
      input_token_expire: "0",
      input_multi_login: "0",
      input_sso_user_name: "",
      input_terminal_permission: "[]",
      user_employee_id: "",
      UserID: USER_ID,
      UserToken: USER_TOKEN,
      pageName: "dashboardUserManager"
    });

    const createResp = await fetch(
      "https://tms.freightapp.com/write_new/write_company_user.php",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: createPayload
      }
    );

    let createJSON;
    try {
      createJSON = await createResp.json();
    } catch {
      const raw = await createResp.text();
      return res.status(500).json({
        error: "Server returned non-JSON response",
        body: raw
      });
    }

    if (!createJSON?.user_id) {
      return res.status(500).json({
        error: "Account creation FAILED",
        response: createJSON
      });
    }

    // ==================================================
    // FINAL OUTPUT
    // ==================================================
    return res.json({
      success: true,
      username: createJSON.user_email,
      password: createJSON.password,
      vendor_location_id: VENDOR_LOCATION_ID,
      meijer_location_id: "407987",
      user_id: createJSON.user_id
    });

  } catch (err) {
    return res.status(500).json({
      error: "Unhandled exception",
      details: err.message || err
    });
  }
}
