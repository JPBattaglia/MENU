import { insertFunnelEvent } from "./funnel.js";
import { verifyStripeSignature } from "./stripe-signature.js";
import { EXTRAS_WINDOW_MINUTES, addDaysIso } from "../lib/config.js";
import { jsonResponse, nowIso } from "../lib/http.js";
import { attachCheckoutMenuDocument, createMenuQrInputs } from "../onboarding/menu-inputs.js";
import { startWebsiteIntake } from "../producers/website/intake.js";
import { startGuestAppIntake } from "../producers/guest-app/intake.js";
import { startConversionFix } from "../producers/conversion/intake.js";
import { startGoogleVisibility } from "../producers/google-visibility/intake.js";
import { refreshOnboardingState } from "../onboarding/onboarding.js";
import { handleExtraPagesPaid } from "../producers/menu-qr/page-billing.js";
import { SUBSCRIPTION_EVENTS, handleSubscriptionEvent, onSubscriptionCheckoutCompleted } from "../subscriptions/webhooks.js";

async function handleStripeWebhook(request, env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    const webhookSecrets = [];
    if (env.STRIPE_WEBHOOK_SECRET) {
      webhookSecrets.push({
        secret: env.STRIPE_WEBHOOK_SECRET,
        environment: "live"
      });
    }
    if (env.STRIPE_WEBHOOK_SECRET_TEST) {
      webhookSecrets.push({
        secret: env.STRIPE_WEBHOOK_SECRET_TEST,
        environment: "sandbox"
      });
    }
    if (webhookSecrets.length === 0) {
      return jsonResponse(
        {
          ok: false,
          error: "No Stripe webhook secrets are configured"
        },
        500
      );
    }
    const signatureHeader = request.headers.get(
      "Stripe-Signature"
    );
    if (!signatureHeader) {
      return jsonResponse(
        {
          ok: false,
          error: "Missing Stripe-Signature header"
        },
        400
      );
    }
    const rawBody = await request.text();
    let verifiedEnvironment = null;
    for (const candidate of webhookSecrets) {
      const valid = await verifyStripeSignature(
        rawBody,
        signatureHeader,
        candidate.secret
      );
      if (valid) {
        verifiedEnvironment = candidate.environment;
        break;
      }
    }
    if (!verifiedEnvironment) {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid Stripe signature"
        },
        400
      );
    }
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON payload"
        },
        400
      );
    }
    if (!event?.id || !event?.type) {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid Stripe event"
        },
        400
      );
    }
    const existingEvent = await env.DB.prepare(`
          SELECT
            id,
            status
          FROM provider_events
          WHERE provider =
            'STRIPE'
            AND provider_event_id =
              ?
          LIMIT 1
        `).bind(event.id).first();
    if (existingEvent?.status === "PROCESSED") {
      return jsonResponse({
        ok: true,
        duplicate: true,
        event_id: event.id,
        environment: verifiedEnvironment
      });
    }
    const internalEventId = crypto.randomUUID();
    const receivedAt = nowIso();
    if (!existingEvent) {
      await env.DB.prepare(`
          INSERT INTO provider_events (
            id,
            provider,
            provider_event_id,
            event_type,
            received_at,
            status,
            attempt_count,
            payload_json
          )
          VALUES (
            ?,
            'STRIPE',
            ?,
            ?,
            ?,
            'RECEIVED',
            0,
            ?
          )
        `).bind(
        internalEventId,
        event.id,
        event.type,
        receivedAt,
        rawBody
      ).run();
    } else {
      await env.DB.prepare(`
          UPDATE provider_events
          SET
            event_type = ?,
            received_at = ?,
            status = 'RECEIVED',
            attempt_count =
              attempt_count + 1,
            last_error = NULL,
            payload_json = ?
          WHERE provider =
            'STRIPE'
            AND provider_event_id =
              ?
        `).bind(
        event.type,
        receivedAt,
        rawBody,
        event.id
      ).run();
    }
    try {
      if (event.type === "checkout.session.completed") {
        if (event.data?.object?.metadata?.purpose === "extra_menu_pages") {
          await handleExtraPagesPaid(event.data.object, env);
        } else {
          await handleCheckoutCompleted(
            event,
            env
          );
          await onSubscriptionCheckoutCompleted(event.data?.object, env, verifiedEnvironment);
        }
      } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
        await handleSubscriptionEvent(event, env, verifiedEnvironment);
      }
      await env.DB.prepare(`
          UPDATE provider_events
          SET
            status = 'PROCESSED',
            processed_at = ?,
            last_error = NULL
          WHERE provider =
            'STRIPE'
            AND provider_event_id =
              ?
        `).bind(
        nowIso(),
        event.id
      ).run();
    } catch (processingError) {
      await env.DB.prepare(`
          UPDATE provider_events
          SET
            status = 'FAILED',
            last_error = ?
          WHERE provider =
            'STRIPE'
            AND provider_event_id =
              ?
        `).bind(
        processingError instanceof Error ? processingError.message : String(
          processingError
        ),
        event.id
      ).run();
      throw processingError;
    }
    return jsonResponse({
      ok: true,
      event_id: event.id,
      event_type: event.type,
      environment: verifiedEnvironment
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

async function handleCheckoutCompleted(event, env) {
  const session = event?.data?.object;
  if (!session) {
    throw new Error(
      "checkout.session.completed event has no session object"
    );
  }
  const orderId = session?.metadata?.order_id || null;
  if (!orderId) {
    return;
  }
  const order = await env.DB.prepare(`
        SELECT
          id,
          customer_id,
          business_id,
          payment_status,
          status,
          notes
        FROM orders
        WHERE id = ?
        LIMIT 1
      `).bind(orderId).first();
  if (!order) {
    throw new Error(
      `Stripe event references unknown order_id: ${orderId}`
    );
  }
  const timestamp = nowIso();
  await env.DB.prepare(`
      UPDATE orders
      SET
        payment_status = 'PAID',

        status = CASE
          WHEN status IN (
            'CREATED',
            'PAYMENT_PENDING'
          )
          THEN 'PAID'
          ELSE status
        END,

        stripe_checkout_session_id =
          COALESCE(
            stripe_checkout_session_id,
            ?
          ),

        stripe_payment_intent_id =
          COALESCE(
            stripe_payment_intent_id,
            ?
          ),

        placed_at =
          COALESCE(
            placed_at,
            ?
          ),

        updated_at = ?

      WHERE id = ?
    `).bind(
    session.id || null,
    session.payment_intent || null,
    timestamp,
    timestamp,
    orderId
  ).run();
  const providerPaymentId = session.payment_intent || session.id;
  if (providerPaymentId) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO payments (
          id,
          order_id,
          customer_id,
          provider,
          provider_payment_id,
          provider_checkout_session_id,
          status,
          amount_cents,
          currency,
          created_at,
          paid_at,
          provider_event_id,
          metadata_json
        )
        VALUES (
          ?,
          ?,
          ?,
          'STRIPE',
          ?,
          ?,
          'SUCCEEDED',
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
      `).bind(
      crypto.randomUUID(),
      orderId,
      order.customer_id,
      providerPaymentId,
      session.id || null,
      Number(
        session.amount_total || 0
      ),
      String(
        session.currency || "usd"
      ).toUpperCase(),
      timestamp,
      timestamp,
      event.id,
      JSON.stringify({
        payment_status: session.payment_status || null,
        mode: session.mode || null
      })
    ).run();
  }
  await env.DB.prepare(`
      UPDATE customers
      SET
        last_purchase_at = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
    timestamp,
    timestamp,
    order.customer_id
  ).run();
  const purchasedItems = await env.DB.prepare(`
        SELECT
          offer_id,
          offer_version_id
        FROM order_items
        WHERE order_id = ?
      `).bind(orderId).all();
  for (const item of purchasedItems.results || []) {
    await insertFunnelEvent(
      env,
      {
        event_type: "PURCHASE_COMPLETED",
        visitor_id: session?.metadata?.visitor_id || null,
        session_id: session?.metadata?.visitor_session_id || null,
        offer_id: item.offer_id,
        offer_version_id: item.offer_version_id,
        order_id: orderId,
        source: session?.metadata?.source || null,
        medium: session?.metadata?.medium || null,
        campaign: session?.metadata?.campaign || null,
        metadata: {
          stripe_event_id: event.id,
          checkout_session_id: session.id || null,
          amount_total: Number(
            session.amount_total || 0
          ),
          currency: String(
            session.currency || "usd"
          ).toUpperCase()
        }
      }
    );
  }
  if (order.business_id) {
    const orderItems = await env.DB.prepare(`
          SELECT
            oi.id AS order_item_id,
            o.category,
            o.default_workflow_key
          FROM order_items oi
          JOIN offers o
            ON o.id =
              oi.offer_id
          WHERE oi.order_id = ?
            AND o.billing_type != 'RECURRING'
        `).bind(orderId).all();
    for (const item of orderItems.results || []) {
      const existingProject = await env.DB.prepare(`
            SELECT id
            FROM projects
            WHERE order_item_id = ?
            LIMIT 1
          `).bind(
        item.order_item_id
      ).first();
      // A retried event must finish what an earlier, interrupted attempt started (e.g. the D1 daily
      // limit hit between the project insert and its inputs), so an existing project is not skipped.
      const projectId = existingProject?.id || crypto.randomUUID();
      if (!existingProject) await env.DB.prepare(`
          INSERT INTO projects (
            id,
            order_id,
            order_item_id,
            business_id,
            customer_id,
            project_type,
            status,
            workflow_key,
            workflow_version,
            priority,
            manual_review_required,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'AWAITING_INPUTS',
            ?,
            1,
            'NORMAL',
            0,
            ?,
            ?
          )
        `).bind(
        projectId,
        orderId,
        item.order_item_id,
        order.business_id,
        order.customer_id,
        item.category,
        item.default_workflow_key,
        timestamp,
        timestamp
      ).run();
      if (item.default_workflow_key === "MENU_QR_V1") {
        // INSERT OR IGNORE per input: creates only the rows a previous attempt did not.
        await createMenuQrInputs(
          projectId,
          order,
          timestamp,
          env
        );
      }
    }
  }
  // A plan-only order has nothing to onboard: its work arrives as monthly period jobs (stage 3).
  const oneTimeItems = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM order_items oi JOIN offers o ON o.id = oi.offer_id
      WHERE oi.order_id = ? AND o.billing_type != 'RECURRING'
    `).bind(orderId).first();
  await env.DB.prepare(`
      UPDATE orders
      SET
        status = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
    Number(oneTimeItems?.n || 0) > 0 ? "ONBOARDING_REQUIRED" : "COMPLETED",
    timestamp,
    orderId
  ).run();
  // The Start page uploads the menu before payment; attach it so the buyer is not asked again.
  const menuProjects = await env.DB.prepare(`
      SELECT id FROM projects WHERE order_id = ? AND workflow_key = 'MENU_QR_V1' AND status = 'AWAITING_INPUTS'
    `).bind(orderId).all();
  for (const menuProject of menuProjects.results || []) {
    try {
      if (await attachCheckoutMenuDocument(menuProject.id, orderId, env)) {
        await env.DB.prepare(`
            UPDATE projects SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.extras_until', ?) WHERE id = ?
          `).bind(addDaysIso(EXTRAS_WINDOW_MINUTES / 1440), menuProject.id).run();
      }
      await refreshOnboardingState(menuProject.id, orderId, order.customer_id, "MENU_QR_V1", env);
    } catch (attachError) {
      // Fail the event so Stripe retries it; the retry is safe (see the project loop above).
      console.error("Checkout menu attachment failed:", attachError instanceof Error ? attachError.message : String(attachError));
      throw attachError;
    }
  }
  const conversionProjects = await env.DB.prepare(`
      SELECT id FROM projects WHERE order_id = ? AND workflow_key = 'CONVERSION_FIX_V1' AND status = 'AWAITING_INPUTS'
    `).bind(orderId).all();
  for (const conversionProject of conversionProjects.results || []) {
    try {
      await startConversionFix(env, { projectId: conversionProject.id, orderId, customerId: order.customer_id, notes: order.notes });
    } catch (startError) {
      console.error("Conversion Fix start failed:", startError instanceof Error ? startError.message : String(startError));
    }
  }
  const visibilityProjects = await env.DB.prepare(`
      SELECT id FROM projects WHERE order_id = ? AND workflow_key = 'GOOGLE_VISIBILITY_V1' AND status = 'AWAITING_INPUTS'
    `).bind(orderId).all();
  for (const visibilityProject of visibilityProjects.results || []) {
    try {
      await startGoogleVisibility(env, { projectId: visibilityProject.id, orderId, customerId: order.customer_id, notes: order.notes });
    } catch (startError) {
      console.error("Google Visibility start failed:", startError instanceof Error ? startError.message : String(startError));
    }
  }
  const websiteProjects = await env.DB.prepare(`
      SELECT id FROM projects WHERE order_id = ? AND workflow_key = 'WEBSITE_PACKAGE_V1' AND status = 'AWAITING_INPUTS'
    `).bind(orderId).all();
  for (const websiteProject of websiteProjects.results || []) {
    try {
      await startWebsiteIntake(env, { projectId: websiteProject.id });
    } catch (startError) {
      console.error("Website intake start failed:", startError instanceof Error ? startError.message : String(startError));
    }
  }
  const appProjects = await env.DB.prepare(`
      SELECT id FROM projects WHERE order_id = ? AND workflow_key = 'GUEST_APP_SETUP_V1' AND status = 'AWAITING_INPUTS'
    `).bind(orderId).all();
  for (const appProject of appProjects.results || []) {
    try {
      await startGuestAppIntake(env, { projectId: appProject.id });
    } catch (startError) {
      console.error("Guest App intake start failed:", startError instanceof Error ? startError.message : String(startError));
    }
  }
  const existingAudit = await env.DB.prepare(`
        SELECT id
        FROM business_events
        WHERE event_type =
          'ORDER_PAID_ONBOARDING_STARTED'
          AND entity_type =
            'ORDER'
          AND entity_id = ?
          AND correlation_id = ?
        LIMIT 1
      `).bind(
    orderId,
    event.id
  ).first();
  if (!existingAudit) {
    await env.DB.prepare(`
        INSERT INTO business_events (
          id,
          created_at,
          event_type,
          entity_type,
          entity_id,
          actor_type,
          actor_id,
          correlation_id,
          payload_json
        )
        VALUES (
          ?,
          ?,
          'ORDER_PAID_ONBOARDING_STARTED',
          'ORDER',
          ?,
          'PROVIDER',
          'STRIPE',
          ?,
          ?
        )
      `).bind(
      crypto.randomUUID(),
      timestamp,
      orderId,
      event.id,
      JSON.stringify({
        checkout_session_id: session.id || null
      })
    ).run();
  }
}

export {
  handleStripeWebhook,
  handleCheckoutCompleted
};
