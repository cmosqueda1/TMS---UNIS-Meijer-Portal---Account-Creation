// /api/tms.js
// Meijer TMS Account Creator
//
// Flow:
//  1) Validate payload from front-end
//  2) (optional) Call E2Open to resolve / validate PRO/PO  [stubbed hook]
//  3) Create TMS user via write_company_user.php
//  4) Create location contact via write_location_contacts_admin.php
//  5) Return summary + temp password

const TMS_BASE = "https://tms.freightapp.com";

const WRITE_USER_URL =
  `${TMS_BASE}/write_new/write_company_user.php`;

const WRITE_LOCATION_URL =
  `${TMS_BASE}/write_new/write_location_contacts_admin.php`;

// --- helpers ----------------------------------------------------

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

// optional hook – safe no-op if you haven’t wired E2Open yet
async function resolvePoWithE2Open({ pro, po }) {
  // If you have an E2Open endpoint, env it and add the call here.
  // Kept as a stub so this file DOES NOT break anything if not set.
  const url = process.env.E2OPEN_URL;
  if (!url) {
    return { pro, po, fromE2Open: false };
  }

  try {
    const body = { pro, po };
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      return { pro, po, fromE2Open: false, error: `E2Open HTTP ${resp.status}` };
    }

    const data = await resp.json().catch(() => ({}));
    return {
      pro: data.pro || pro || "",
      po: data.po || po || "",
      fromE2Open: true,
    };
  } catch (err) {
    return { pro, po, fromE2Open: false, error: err.message };
  }
}

// --- main handler -----------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const {
    firstName,
    lastName,
    email,
    pro: rawPro,
    po: rawPo,
  } = req.body || {};

  // Basic validation – front-end already does most of this
  if (!firstName || !lastName || !email || (!rawPro && !rawPo)) {
    return sendJson(res, 400, {
      error: "Missing required fields (firstName, lastName, email, and PRO or PO).",
    });
  }

  const TMS_USER_ID = process.env.TMS_USER_ID;
  const TMS_USER_TOKEN = process.env.TMS_USER_TOKEN;

  if (!TMS_USER_ID || !TMS_USER_TOKEN) {
    return sendJson(res, 500, {
      error: "TMS credentials are not configured (TMS_USER_ID / TMS_USER_TOKEN).",
    });
  }

  // Meijer location / warehouse mapping – default from your HAR, override via env
  const TMS_WAREHOUSE_LOCATION_ID =
    process.env.TMS_WAREHOUSE_LOCATION_ID || "407987"; // MEIJER INC C/O INTELLIGENT AUDIT

  // --- Step 1: (optional) resolve via E2Open --------------------
  const pro = (rawPro || "").trim();
  const po = (rawPo || "").trim();

  const e2open = await resolvePoWithE2Open({ pro, po });

  // --- Step 2: Create TMS user ---------------------------------
  try {
    const form = new URLSearchParams();

    // Core user details
    form.set("input_user_id", "0");
    form.set("input_email", email);
    form.set("input_username", email);
    form.set("input_firstname", firstName);
    form.set("input_lastname", lastName);

    // Group / permissions – from working HAR example
    form.set("input_group", "104"); // SB CUST
    form.set("input_group_terminals", "undefined");

    // Optional / misc – keep aligned with HAR, even if blank
    form.set("input_mobile", "");
    form.set("input_dob", "");
    form.set("input_doh", "");
    form.set("input_dl_expiry", "");
    form.set("input_license", "undefined");
    form.set("input_license_mm", "undefined");
    form.set("input_license_dd", "undefined");
    form.set("input_license_yy", "undefined");
    form.set("input_warehouse_driver", "undefined");
    form.set("input_rv", "undefined");
    form.set("input_rv_code", "undefined");
    form.set("input_pay_type", "undefined");
    form.set("input_project", "0");
    form.set("input_pay_amount", "undefined");
    form.set("input_active", "1");
    form.set("use_sso_login", "0");
    form.set("use_sso_domain", "");
    form.set("input_safety", "0");
    form.set("input_watch", "0");
    form.set("input_driver", "0");
    form.set("input_tablet", "0");

    // Key: warehouse / location on the user record
    form.set("input_warehouse_user", TMS_WAREHOUSE_LOCATION_ID);

    form.set("input_gp_code", "");
    form.set("input_ext_code", "");
    form.set("input_bypass", "0");
    form.set("input_maintenance", "0");
    form.set("input_timezone", "PST");
    form.set("input_user_type", "0");
    form.set("input_developer_ftp", "");
    form.set("input_employee", "0");
    form.set("input_warehouse_user", TMS_WAREHOUSE_LOCATION_ID);
    form.set("input_text_notification", "0");
    form.set("input_email_notification", "0");
    form.set("input_app_notification", "0");
    form.set("input_eld_support", "0");
    form.set("input_is_vendor", "0");
    form.set("input_claims_access", "0");
    form.set("input_token_expire", "0");
    form.set("input_multi_login", "0");
    form.set("input_sso_user_name", "");
    form.set("input_terminal_permission", "[]");

    // Auth from env (NO extra login step)
    form.set("UserID", TMS_USER_ID);
    form.set("UserToken", TMS_USER_TOKEN);
    form.set("pageName", "dashboardUserManager");

    const createResp = await fetch(WRITE_USER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: form.toString(),
    });

    const createJson = await createResp.json().catch(() => null);

    if (!createResp.ok || !createJson || !createJson.user_id) {
      return sendJson(res, 500, {
        error: "Account creation FAILED in TMS",
        debug: {
          status: createResp.status,
          body: createJson,
        },
      });
    }

    const newUserId = createJson.user_id;
    const tempPassword = createJson.password || "";

    // --- Step 3: Create Location Contact -----------------------
    const locForm = new URLSearchParams();

    locForm.set("input_location_contacts_id", "0");
    locForm.set("input_fk_user_id", String(newUserId));
    locForm.set("input_location_contacts_name", firstName);
    locForm.set("input_location_contacts_lastname", lastName);
    locForm.set("input_location_contacts_title", "");
    locForm.set("input_location_contacts_phone", "");
    locForm.set("input_location_contacts_fax", "");
    locForm.set("input_location_contacts_email", ""); // HAR kept this blank
    locForm.set("input_location_contacts_type", "CSR");
    locForm.set("input_fk_location_id", TMS_WAREHOUSE_LOCATION_ID);
    locForm.set("input_contacts_notify_email", "0");
    locForm.set("input_contacts_notify_phone", "0");
    locForm.set("input_contacts_notify_text", "0");
    locForm.set("input_contacts_notify_fax", "0");
    locForm.set("input_location_contacts_status", "1");
    locForm.set("input_is_user_manager", "1");

    locForm.set("UserID", TMS_USER_ID);
    locForm.set("UserToken", TMS_USER_TOKEN);
    locForm.set("pageName", "dashboardUserManager");

    const locResp = await fetch(WRITE_LOCATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: locForm.toString(),
    });

    const locJson = await locResp.json().catch(() => null);

    if (!locResp.ok || !locJson || !locJson.location_contacts_id) {
      return sendJson(res, 500, {
        error: "Location contact creation FAILED",
        tmsUserId: newUserId,
        debug: {
          status: locResp.status,
          body: locJson,
        },
      });
    }

    // --- Final response back to UI -----------------------------
    return sendJson(res, 200, {
      success: true,
      message: "TMS user and location contact created.",
      tmsUserId: newUserId,
      tempPassword,
      locationContactId: locJson.location_contacts_id,
      meijerLocationId: TMS_WAREHOUSE_LOCATION_ID,
      e2open: e2open,
    });
  } catch (err) {
    console.error("TMS account creator error:", err);
    return sendJson(res, 500, {
      error: "Unexpected server error",
      details: err.message,
    });
  }
}
