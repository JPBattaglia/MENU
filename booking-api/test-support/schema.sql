-- Copied from the live menu-made-db (sqlite_master) on 2026-10-25 for local tests.
-- Only the tables the production pipeline touches. Keep CHECK constraints identical to production.
CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
        'ACTIVE','INACTIVE','FORMER','REFUNDED','BLOCKED'
    )),
    stripe_customer_id TEXT,
    marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0,1)),
    preferred_contact_method TEXT,
    last_purchase_at TEXT,
    lifetime_value_cents INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_value_cents >= 0),
    notes TEXT
);
CREATE TABLE businesses (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    name TEXT NOT NULL,
    legal_name TEXT,
    website_url TEXT,
    primary_domain TEXT,
    phone TEXT,
    email TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state_region TEXT,
    postal_code TEXT,
    country TEXT,
    segment TEXT,
    business_status TEXT NOT NULL DEFAULT 'PROSPECT' CHECK (business_status IN (
        'PROSPECT','ACTIVE_CUSTOMER','FORMER_CUSTOMER','INACTIVE','CLOSED','DO_NOT_SERVICE'
    )),
    ordering_platform TEXT,
    reservation_platform TEXT,
    pos_platform TEXT,
    google_business_url TEXT,
    instagram_url TEXT,
    facebook_url TEXT,
    brand_assets_status TEXT,
    notes TEXT
);
CREATE TABLE offers (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'AUDIT','MENU','WEBSITE','VISIBILITY','ACCESSIBILITY',
        'DESIGN','MERCH','APP','CARE_PLAN','OTHER'
    )),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','RETIRED')),
    billing_type TEXT NOT NULL CHECK (billing_type IN ('ONE_TIME','RECURRING','HYBRID')),
    fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('DIGITAL','PHYSICAL','HYBRID','MANUAL')),
    requires_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0,1)),
    requires_assets INTEGER NOT NULL DEFAULT 0 CHECK (requires_assets IN (0,1)),
    default_workflow_key TEXT NOT NULL,
    public_slug TEXT,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0,1)),
    is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0,1)),
    short_description TEXT,
    cta_text TEXT NOT NULL DEFAULT 'Get Started',
    display_badge TEXT
);
CREATE TABLE offer_versions (
    id TEXT PRIMARY KEY,
    offer_id TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    created_at TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    billing_interval TEXT CHECK (billing_interval IS NULL OR billing_interval IN ('MONTH','YEAR')),
    setup_fee_cents INTEGER CHECK (setup_fee_cents IS NULL OR setup_fee_cents >= 0),
    scope_json TEXT NOT NULL,
    exclusions_json TEXT,
    required_inputs_json TEXT,
    revision_limit INTEGER CHECK (revision_limit IS NULL OR revision_limit >= 0),
    estimated_manual_minutes INTEGER CHECK (estimated_manual_minutes IS NULL OR estimated_manual_minutes >= 0),
    stripe_price_id TEXT,
    stripe_product_id TEXT,
    FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE RESTRICT,
    UNIQUE (offer_id, version_number)
);
CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    business_id TEXT,
    status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN (
        'CREATED','PAYMENT_PENDING','PAID','ONBOARDING_REQUIRED',
        'READY_FOR_PRODUCTION','IN_PRODUCTION','QC_REQUIRED',
        'CUSTOMER_APPROVAL_REQUIRED','DELIVERED','COMPLETED',
        'CANCELLED','REFUND_PENDING','REFUNDED','FAILED'
    )),
    currency TEXT NOT NULL DEFAULT 'USD',
    subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
    discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
    tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN (
        'UNPAID','PENDING','PAID','PARTIALLY_REFUNDED','REFUNDED','FAILED','DISPUTED'
    )),
    stripe_checkout_session_id TEXT,
    stripe_payment_intent_id TEXT,
    source_lead_id TEXT,
    campaign_id TEXT,
    placed_at TEXT,
    cancelled_at TEXT,
    completed_at TEXT,
    notes TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL
);
CREATE TABLE order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    offer_id TEXT NOT NULL,
    offer_version_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
    fulfillment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (fulfillment_status IN (
        'PENDING','READY','IN_PROGRESS','AWAITING_APPROVAL','FULFILLED','FAILED','CANCELLED'
    )),
    metadata_json TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
    FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE RESTRICT,
    FOREIGN KEY (offer_version_id) REFERENCES offer_versions(id) ON DELETE RESTRICT
);
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    order_item_id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    project_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN (
        'CREATED','AWAITING_INPUTS','READY','IN_PROGRESS','AUTOMATION_RUNNING',
        'QC_REQUIRED','CUSTOMER_APPROVAL_REQUIRED','BLOCKED',
        'DELIVERY_READY','DELIVERED','COMPLETED','CANCELLED','FAILED'
    )),
    workflow_key TEXT NOT NULL,
    workflow_version INTEGER NOT NULL DEFAULT 1 CHECK (workflow_version > 0),
    priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','HIGH','URGENT')),
    assigned_to TEXT,
    started_at TEXT,
    due_at TEXT,
    completed_at TEXT,
    blocked_reason TEXT,
    manual_review_required INTEGER NOT NULL DEFAULT 0 CHECK (manual_review_required IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
);
CREATE TABLE project_inputs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    input_key TEXT NOT NULL,
    input_type TEXT NOT NULL CHECK (input_type IN ('TEXT','URL','FILE','BOOLEAN','SELECT','JSON')),
    value_text TEXT,
    value_json TEXT,
    asset_id TEXT,
    required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
    status TEXT NOT NULL DEFAULT 'MISSING' CHECK (status IN (
        'MISSING','SUBMITTED','VALID','INVALID','NEEDS_REVIEW'
    )),
    validation_message TEXT,
    submitted_at TEXT,
    validated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL,
    UNIQUE (project_id, input_key)
);
CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    business_id TEXT,
    customer_id TEXT,
    project_id TEXT,
    asset_type TEXT NOT NULL CHECK (asset_type IN (
        'LOGO','BRAND_GUIDE','MENU_SOURCE','PHOTO','ILLUSTRATION',
        'DESIGN_SOURCE','PROOF','DELIVERABLE','PRODUCT_MOCKUP',
        'WEBSITE_EXPORT','DOCUMENT','OTHER'
    )),
    storage_provider TEXT NOT NULL DEFAULT 'R2',
    storage_key TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    checksum TEXT,
    width_px INTEGER,
    height_px INTEGER,
    status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (status IN (
        'UPLOADED','VALIDATING','VALID','INVALID','QUARANTINED','ARCHIVED'
    )),
    uploaded_at TEXT NOT NULL,
    validated_at TEXT,
    approved_for_use INTEGER NOT NULL DEFAULT 0 CHECK (approved_for_use IN (0,1)),
    is_customer_supplied INTEGER NOT NULL DEFAULT 1 CHECK (is_customer_supplied IN (0,1)),
    rights_confirmed INTEGER CHECK (rights_confirmed IS NULL OR rights_confirmed IN (0,1)),
    metadata_json TEXT,
    UNIQUE (storage_provider, storage_key)
);
CREATE TABLE deliverables (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    deliverable_type TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINAL','SUPERSEDED')),
    customer_visible INTEGER NOT NULL DEFAULT 0 CHECK (customer_visible IN (0,1)),
    delivered_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
    UNIQUE (project_id, deliverable_type, version)
);
CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    asset_id TEXT,
    approval_type TEXT NOT NULL,
    requested_from_customer_id TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING','APPROVED','CHANGES_REQUESTED','EXPIRED','CANCELLED'
    )),
    revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number > 0),
    revision_limit INTEGER CHECK (revision_limit IS NULL OR revision_limit >= 0),
    customer_comments TEXT,
    requested_at TEXT NOT NULL,
    responded_at TEXT,
    approved_at TEXT,
    expires_at TEXT,
    approved_by TEXT,
    metadata_json TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE communications (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    lead_id TEXT,
    customer_id TEXT,
    business_id TEXT,
    order_id TEXT,
    project_id TEXT,
    campaign_id TEXT,
    channel TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','PHONE','DM','SYSTEM')),
    direction TEXT NOT NULL CHECK (direction IN ('OUTBOUND','INBOUND')),
    purpose TEXT,
    template_key TEXT,
    subject TEXT,
    recipient TEXT,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
        'QUEUED','SENT','DELIVERED','BOUNCED','FAILED','REPLIED','SUPPRESSED'
    )),
    provider_message_id TEXT,
    sent_at TEXT,
    delivered_at TEXT,
    replied_at TEXT,
    error_message TEXT,
    metadata_json TEXT
);
CREATE TABLE business_events (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('SYSTEM','CUSTOMER','ADMIN','PROVIDER')),
    actor_id TEXT,
    correlation_id TEXT,
    payload_json TEXT
);
CREATE TABLE system_errors (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','ERROR','CRITICAL')),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RETRYING','RESOLVED','IGNORED')),
    message TEXT NOT NULL,
    lead_id TEXT,
    customer_id TEXT,
    business_id TEXT,
    order_id TEXT,
    project_id TEXT,
    workflow_run_id TEXT,
    provider_event_id TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    next_retry_at TEXT,
    resolved_at TEXT,
    manual_intervention_required INTEGER NOT NULL DEFAULT 0 CHECK (manual_intervention_required IN (0,1)),
    details_json TEXT
);
CREATE TABLE workflow_definitions (
  id TEXT PRIMARY KEY,
  workflow_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  steps_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workflow_key, version)
);
CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    workflow_key TEXT NOT NULL,
    workflow_version INTEGER NOT NULL CHECK (workflow_version > 0),
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
        'QUEUED','RUNNING','WAITING','SUCCEEDED','FAILED','CANCELLED'
    )),
    trigger_type TEXT NOT NULL,
    trigger_reference TEXT,
    started_at TEXT,
    completed_at TEXT,
    failed_at TEXT,
    attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
    error_code TEXT,
    error_message TEXT,
    output_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE workflow_steps (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    step_key TEXT NOT NULL,
    step_order INTEGER NOT NULL CHECK (step_order >= 0),
    status TEXT NOT NULL CHECK (status IN (
        'QUEUED','RUNNING','WAITING','SUCCEEDED','FAILED','SKIPPED','CANCELLED'
    )),
    started_at TEXT,
    completed_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    input_json TEXT,
    output_json TEXT,
    error_message TEXT,
    external_reference TEXT,
    FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
    UNIQUE (workflow_run_id, step_key, step_order)
);
CREATE UNIQUE INDEX ux_workflow_runs_ready_trigger
ON workflow_runs (project_id, workflow_key, workflow_version, trigger_type, trigger_reference);
CREATE TABLE mm_booking_requests (   id TEXT PRIMARY KEY,   payload TEXT NOT NULL,   ip_hash TEXT NOT NULL,   created_at INTEGER NOT NULL,   owner_sent INTEGER NOT NULL DEFAULT 0,   customer_sent INTEGER NOT NULL DEFAULT 0,   attempts INTEGER NOT NULL DEFAULT 0 );
CREATE TABLE provider_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN (
        'RECEIVED','PROCESSED','FAILED','IGNORED'
    )),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error TEXT,
    payload_json TEXT,
    related_order_id TEXT,
    related_customer_id TEXT,
    FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL,
    FOREIGN KEY (related_customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    UNIQUE (provider, provider_event_id)
);
CREATE INDEX idx_provider_events_status
ON provider_events(provider, status, received_at);
CREATE TABLE IF NOT EXISTS self_tests (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('REQUESTED','RUNNING','PASSED','FAILED')),
    stage TEXT,
    requested_by TEXT,
    order_id TEXT,
    project_id TEXT,
    state_json TEXT,
    log_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    stage_started_at TEXT,
    finished_at TEXT
);
CREATE TABLE customer_businesses (
    customer_id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    role TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
    created_at TEXT NOT NULL,
    PRIMARY KEY (customer_id, business_id),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT
);
CREATE TABLE funnel_events (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'SITE_VISIT',
            'OFFER_VIEW',
            'CTA_CLICK',
            'CHECKOUT_STARTED',
            'PURCHASE_COMPLETED'
        )
    ),
    visitor_id TEXT,
    session_id TEXT,
    offer_id TEXT,
    offer_version_id TEXT,
    order_id TEXT,
    source TEXT,
    medium TEXT,
    campaign TEXT,
    referrer TEXT,
    landing_path TEXT,
    metadata_json TEXT,
    FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL,
    FOREIGN KEY (offer_version_id) REFERENCES offer_versions(id) ON DELETE SET NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);
CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'STRIPE',
    provider_payment_id TEXT NOT NULL,
    provider_checkout_session_id TEXT,
    status TEXT NOT NULL CHECK (status IN (
        'PENDING','SUCCEEDED','FAILED','CANCELLED',
        'PARTIALLY_REFUNDED','REFUNDED','DISPUTED'
    )),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    payment_method_type TEXT,
    created_at TEXT NOT NULL,
    paid_at TEXT,
    failed_at TEXT,
    failure_code TEXT,
    failure_message TEXT,
    provider_event_id TEXT,
    metadata_json TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    UNIQUE (provider, provider_payment_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_email ON customers(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_checkout_session ON orders(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_runs_ready_trigger ON workflow_runs (project_id, workflow_key, workflow_version, trigger_type, trigger_reference);
CREATE UNIQUE INDEX IF NOT EXISTS ux_offers_code ON offers(code);
CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    offer_id TEXT NOT NULL,
    offer_version_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'STRIPE',
    provider_subscription_id TEXT NOT NULL,
    provider_customer_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'INCOMPLETE','TRIALING','ACTIVE','PAST_DUE','PAUSED',
        'CANCELLED','EXPIRED','UNPAID'
    )),
    billing_interval TEXT NOT NULL CHECK (billing_interval IN ('MONTH','YEAR')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    current_period_start TEXT,
    current_period_end TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0,1)),
    started_at TEXT NOT NULL,
    cancelled_at TEXT,
    ended_at TEXT,
    trial_ends_at TEXT,
    grace_ends_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT,
    FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE RESTRICT,
    FOREIGN KEY (offer_version_id) REFERENCES offer_versions(id) ON DELETE RESTRICT,
    UNIQUE (provider, provider_subscription_id)
);
CREATE TABLE entitlements (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    subscription_id TEXT,
    order_item_id TEXT,
    entitlement_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','EXPIRED')),
    starts_at TEXT NOT NULL,
    ends_at TEXT,
    quantity_limit INTEGER CHECK (quantity_limit IS NULL OR quantity_limit >= 0),
    quantity_used INTEGER NOT NULL DEFAULT 0 CHECK (quantity_used >= 0),
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
    CHECK (subscription_id IS NOT NULL OR order_item_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_offers_public_slug ON offers(public_slug) WHERE public_slug IS NOT NULL;
