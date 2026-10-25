import { FROM_ADDRESS, INTERNAL_BCC, REPLY_TO_ADDRESS, RESEND_ENDPOINT, escapeHtml, logEmailEvent } from "../lib/email.js";

function formatCustomerName(firstName, lastName) {
  return [
    firstName,
    lastName
  ].filter(Boolean).join(" ").trim();
}

function formatServiceNames(rows) {
  const names = (rows || []).map(
    (row) => String(
      row.offer_name || ""
    ).trim()
  ).filter(Boolean);
  if (names.length === 0) {
    return "Menu-Made service";
  }
  return names.join(", ");
}

async function loadConfirmationContext(projectId, orderId, env) {
  const context = await env.DB.prepare(`
        SELECT
          p.id AS project_id,
          p.status AS project_status,
          p.project_type,
          p.workflow_key,
          p.workflow_version,

          o.id AS order_id,
          o.status AS order_status,
          o.payment_status,

          b.id AS business_id,
          b.name AS business_name,

          c.id AS customer_id,
          c.email AS customer_email,
          c.first_name,
          c.last_name

        FROM projects p

        JOIN orders o
          ON o.id =
            p.order_id

        JOIN businesses b
          ON b.id =
            p.business_id

        JOIN customers c
          ON c.id =
            p.customer_id

        WHERE
          p.id = ?
          AND o.id = ?

        LIMIT 1
      `).bind(
    projectId,
    orderId
  ).first();
  if (!context) {
    throw new Error(
      "Could not load onboarding email context"
    );
  }
  const serviceResult = await env.DB.prepare(`
        SELECT
          offers.name AS offer_name
        FROM order_items

        JOIN offers
          ON offers.id =
            order_items.offer_id

        WHERE
          order_items.order_id = ?

        ORDER BY
          offers.sort_order ASC,
          offers.name ASC
      `).bind(
    orderId
  ).all();
  return {
    ...context,
    serviceNames: formatServiceNames(
      serviceResult.results || []
    )
  };
}

async function confirmationAlreadySent(projectId, env) {
  const existing = await env.DB.prepare(`
        SELECT id
        FROM business_events
        WHERE
          event_type =
            'ONBOARDING_CONFIRMATION_EMAIL_SENT'

          AND entity_type =
            'PROJECT'

          AND entity_id = ?

        LIMIT 1
      `).bind(
    projectId
  ).first();
  return Boolean(existing);
}

function buildConfirmationEmail(context) {
  const customerName = formatCustomerName(
    context.first_name,
    context.last_name
  );
  const greeting = customerName ? `Hi ${escapeHtml(customerName)},` : "Hello,";
  const businessName = escapeHtml(
    context.business_name || "your business"
  );
  const orderId = escapeHtml(
    context.order_id
  );
  const services = escapeHtml(
    context.serviceNames
  );
  const subject = `Your Menu-Made project is ready for production`;
  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>${subject}</title>
</head>

<body style="
  margin:0;
  padding:0;
  background:#f4f7f8;
  font-family:Arial,Helvetica,sans-serif;
  color:#18313a;
">
  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="
      width:100%;
      background:#f4f7f8;
      padding:32px 16px;
    "
  >
    <tr>
      <td align="center">

        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            max-width:640px;
            background:#ffffff;
            border-radius:14px;
            overflow:hidden;
            box-shadow:
              0 8px 28px rgba(0,0,0,0.08);
          "
        >

          <tr>
            <td
              style="
                background:#003f52;
                padding:28px 32px;
                color:#ffffff;
              "
            >
              <div
                style="
                  font-size:25px;
                  font-weight:700;
                  letter-spacing:0.5px;
                "
              >
                MENU-MADE
              </div>

              <div
                style="
                  margin-top:7px;
                  color:#42d9eb;
                  font-size:14px;
                "
              >
                Digital tools for independent restaurants
              </div>
            </td>
          </tr>

          <tr>
            <td
              style="
                padding:36px 32px;
              "
            >
              <p
                style="
                  margin:0 0 22px;
                  font-size:16px;
                  line-height:1.6;
                "
              >
                ${greeting}
              </p>

              <h1
                style="
                  margin:0 0 18px;
                  color:#003f52;
                  font-size:26px;
                  line-height:1.25;
                "
              >
                Your project is ready for production.
              </h1>

              <p
                style="
                  margin:0 0 24px;
                  font-size:16px;
                  line-height:1.65;
                "
              >
                We received the required project information
                for <strong>${businessName}</strong>.
                Your Menu-Made project has now moved into
                the production workflow.
              </p>

              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  margin:0 0 26px;
                  background:#f1f8f9;
                  border:1px solid #d7eaed;
                  border-radius:10px;
                "
              >
                <tr>
                  <td
                    style="
                      padding:20px;
                      font-size:15px;
                      line-height:1.7;
                    "
                  >
                    <strong>Business:</strong>
                    ${businessName}
                    <br>

                    <strong>Service:</strong>
                    ${services}
                    <br>

                    <strong>Order reference:</strong>
                    ${orderId}
                  </td>
                </tr>
              </table>

              <p
                style="
                  margin:0 0 20px;
                  font-size:16px;
                  line-height:1.65;
                "
              >
                There is nothing else you need to submit
                right now. If we need clarification or
                additional access while your project is
                being completed, we will contact you.
              </p>

              <p
                style="
                  margin:0;
                  font-size:16px;
                  line-height:1.65;
                "
              >
                Thank you for choosing Menu-Made.
              </p>
            </td>
          </tr>

          <tr>
            <td
              style="
                background:#003f52;
                padding:24px 32px;
                text-align:center;
                color:#d8f3f6;
                font-size:13px;
                line-height:1.6;
              "
            >
              Menu-Made
              <br>
              menu-made.com
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
  const text = `
${customerName ? `Hi ${customerName},` : "Hello,"}

Your project is ready for production.

We received the required project information for ${context.business_name || "your business"}.

Business: ${context.business_name || "your business"}
Service: ${context.serviceNames}
Order reference: ${context.order_id}

Your Menu-Made project has now moved into the production workflow.

There is nothing else you need to submit right now. If we need clarification or additional access while your project is being completed, we will contact you.

Thank you for choosing Menu-Made.

Menu-Made
menu-made.com
  `.trim();
  return {
    subject,
    html,
    text
  };
}

async function sendOnboardingConfirmationEmail({
  projectId,
  orderId
}, env) {
  if (!env.DB) {
    return {
      ok: false,
      skipped: true,
      error: "D1 binding DB is not available"
    };
  }
  if (!env.RESEND_API_KEY) {
    return {
      ok: false,
      skipped: true,
      error: "RESEND_API_KEY is not configured"
    };
  }
  const alreadySent = await confirmationAlreadySent(
    projectId,
    env
  );
  if (alreadySent) {
    return {
      ok: true,
      skipped: true,
      reason: "already_sent"
    };
  }
  const context = await loadConfirmationContext(
    projectId,
    orderId,
    env
  );
  const recipient = String(
    context.customer_email || ""
  ).trim();
  if (!recipient) {
    await logEmailEvent(
      {
        eventType: "ONBOARDING_CONFIRMATION_EMAIL_FAILED",
        projectId,
        orderId,
        customerId: context.customer_id,
        payload: {
          reason: "Customer email is missing"
        }
      },
      env
    );
    return {
      ok: false,
      skipped: true,
      error: "Customer email is missing"
    };
  }
  const email = buildConfirmationEmail(
    context
  );
  const idempotencyKey = `onboarding-ready/${projectId}`;
  let response;
  try {
    response = await fetch(
      RESEND_ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [
            recipient
          ],
          bcc: [
            INTERNAL_BCC
          ],
          reply_to: REPLY_TO_ADDRESS,
          subject: email.subject,
          html: email.html,
          text: email.text
        })
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logEmailEvent(
      {
        eventType: "ONBOARDING_CONFIRMATION_EMAIL_FAILED",
        projectId,
        orderId,
        customerId: context.customer_id,
        payload: {
          recipient,
          error: message
        }
      },
      env
    );
    return {
      ok: false,
      error: message
    };
  }
  let responseData = null;
  try {
    responseData = await response.json();
  } catch {
    responseData = null;
  }
  if (!response.ok) {
    const message = responseData?.message || responseData?.error || `Resend returned HTTP ${response.status}`;
    await logEmailEvent(
      {
        eventType: "ONBOARDING_CONFIRMATION_EMAIL_FAILED",
        projectId,
        orderId,
        customerId: context.customer_id,
        payload: {
          recipient,
          status: response.status,
          error: message,
          response: responseData
        }
      },
      env
    );
    return {
      ok: false,
      status: response.status,
      error: message
    };
  }
  const resendEmailId = responseData?.id || null;
  await logEmailEvent(
    {
      eventType: "ONBOARDING_CONFIRMATION_EMAIL_SENT",
      projectId,
      orderId,
      customerId: context.customer_id,
      payload: {
        recipient,
        bcc: INTERNAL_BCC,
        from: FROM_ADDRESS,
        reply_to: REPLY_TO_ADDRESS,
        resend_email_id: resendEmailId,
        idempotency_key: idempotencyKey
      }
    },
    env
  );
  return {
    ok: true,
    email_id: resendEmailId
  };
}

export {
  formatCustomerName,
  formatServiceNames,
  loadConfirmationContext,
  confirmationAlreadySent,
  buildConfirmationEmail,
  sendOnboardingConfirmationEmail
};
