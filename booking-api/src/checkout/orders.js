import { normalizeEmail, normalizeName, nowIso, splitName } from "../lib/http.js";

async function createPendingOrder(data, normalizedItems, env, environment) {
  const customerInput = data?.customer || {};
  const email = normalizeEmail(
    customerInput.email || data.email
  );
  const name = normalizeName(
    customerInput.name || data.name
  );
  const businessName = normalizeName(
    customerInput.business || data.business
  );
  const phone = normalizeName(
    customerInput.phone || data.phone
  );
  const notes = normalizeName(
    customerInput.notes || data.notes
  );
  if (!email) {
    return {
      ok: false,
      status: 400,
      error: "Customer email is required"
    };
  }
  const timestamp = nowIso();
  const existingCustomer = await env.DB.prepare(`
        SELECT id
        FROM customers
        WHERE lower(email) =
          lower(?)
        LIMIT 1
      `).bind(email).first();
  let customerId;
  if (existingCustomer) {
    customerId = existingCustomer.id;
    const {
      firstName,
      lastName
    } = splitName(name);
    await env.DB.prepare(`
        UPDATE customers
        SET
          first_name =
            COALESCE(
              ?,
              first_name
            ),

          last_name =
            COALESCE(
              ?,
              last_name
            ),

          phone =
            COALESCE(
              ?,
              phone
            ),

          updated_at = ?

        WHERE id = ?
      `).bind(
      firstName,
      lastName,
      phone || null,
      timestamp,
      customerId
    ).run();
  } else {
    customerId = crypto.randomUUID();
    const {
      firstName,
      lastName
    } = splitName(name);
    await env.DB.prepare(`
        INSERT INTO customers (
          id,
          created_at,
          updated_at,
          email,
          first_name,
          last_name,
          phone,
          status,
          marketing_consent,
          lifetime_value_cents
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          'ACTIVE',
          0,
          0
        )
      `).bind(
      customerId,
      timestamp,
      timestamp,
      email,
      firstName,
      lastName,
      phone || null
    ).run();
  }
  let businessId = null;
  if (businessName) {
    const existingBusiness = await env.DB.prepare(`
          SELECT id
          FROM businesses
          WHERE lower(name) =
            lower(?)
            AND business_status
              <> 'CLOSED'
          ORDER BY
            created_at ASC
          LIMIT 1
        `).bind(businessName).first();
    if (existingBusiness) {
      businessId = existingBusiness.id;
    } else {
      businessId = crypto.randomUUID();
      await env.DB.prepare(`
          INSERT INTO businesses (
            id,
            created_at,
            updated_at,
            name,
            phone,
            email,
            business_status,
            notes
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'ACTIVE_CUSTOMER',
            ?
          )
        `).bind(
        businessId,
        timestamp,
        timestamp,
        businessName,
        phone || null,
        email,
        notes || null
      ).run();
    }
    await env.DB.prepare(`
        INSERT OR IGNORE
        INTO customer_businesses (
          customer_id,
          business_id,
          role,
          is_primary,
          created_at
        )
        VALUES (
          ?,
          ?,
          'CUSTOMER',
          1,
          ?
        )
      `).bind(
      customerId,
      businessId,
      timestamp
    ).run();
  }
  const orderId = crypto.randomUUID();
  const subtotalCents = normalizedItems.reduce(
    (sum, item) => sum + item.priceCents * item.quantity,
    0
  );
  const currency = normalizedItems[0]?.currency || "USD";
  await env.DB.prepare(`
      INSERT INTO orders (
        id,
        created_at,
        updated_at,
        customer_id,
        business_id,
        status,
        currency,
        subtotal_cents,
        discount_cents,
        tax_cents,
        total_cents,
        payment_status,
        notes
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        'PAYMENT_PENDING',
        ?,
        ?,
        0,
        0,
        ?,
        'PENDING',
        ?
      )
    `).bind(
    orderId,
    timestamp,
    timestamp,
    customerId,
    businessId,
    currency,
    subtotalCents,
    subtotalCents,
    notes || null
  ).run();
  for (const item of normalizedItems) {
    await env.DB.prepare(`
        INSERT INTO order_items (
          id,
          order_id,
          offer_id,
          offer_version_id,
          quantity,
          unit_price_cents,
          line_total_cents,
          fulfillment_status,
          metadata_json
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          'PENDING',
          ?
        )
      `).bind(
      crypto.randomUUID(),
      orderId,
      item.offerId,
      item.offerVersionId,
      item.quantity,
      item.priceCents,
      item.priceCents * item.quantity,
      JSON.stringify({
        offer_code: item.offerCode,
        environment,
        ...(item.menuPackage ? { menu_package: item.menuPackage } : {}),
        ...(item.extraMetadata || {})
      })
    ).run();
  }
  return {
    ok: true,
    orderId,
    customerId,
    businessId,
    email,
    name,
    businessName,
    phone,
    notes
  };
}

export {
  createPendingOrder
};
