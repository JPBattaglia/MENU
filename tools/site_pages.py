#!/usr/bin/env python3
"""Stage 9 page builder for menu-made.com.

Writes the revamped pages (home, plans, services, Start, privacy and the product pages) from one
shared head, header and footer, and refreshes the header navigation and footer links on every other
page. Prices are never written here: every price is a <span data-price-for="CODE"> that
site-catalog.js fills from /api/catalog.

Run from the repo root:  python3 tools/site_pages.py
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
CSS_VERSION = "20261028-accounts"
CATALOG_JS = '<script src="site-catalog.js?v=20261028-stage9" defer></script>'

NAV = [
    ("index.html", "Home"),
    ("plans.html", "Plans"),
    ("services.html", "Services"),
    ("portfolio.html", "Our Work"),
    ("about.html", "About"),
    ("account.html", "Account"),
]

FOOTER_LINKS = (
    '<nav class="footer-links" aria-label="More from MENU-MADE">'
    '<a href="plans.html">Plans &amp; Pricing</a>'
    '<a href="services.html">Services</a>'
    '<a href="website-design.html">Website Package</a>'
    '<a href="google-visibility.html">Google Visibility</a>'
    '<a href="accessibility-services.html">Accessibility Monitoring</a>'
    '<a href="portfolio.html">Our Work</a>'
    '<a href="about.html">Meet JP &amp; Nino</a>'
    '<a href="account.html">Your account</a>'
    '<a href="privacy.html">Privacy</a>'
    '<a href="accessability.html">Site Accessibility</a>'
    '</nav>'
)

SOCIAL = """    <div class="footer-social" aria-label="Social links">
      <a class="social-icon" href="https://www.facebook.com/MenuMade.OnlinePresence" target="_blank" rel="noopener" aria-label="Facebook">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8.5V7c0-.8.5-1 1-1h2V3h-3c-2.8 0-4 1.7-4 4v1.5H8V12h2v9h4v-9h2.7l.3-3.5H14z"/></svg>
      </a>
      <a class="social-icon" href="https://www.linkedin.com/company/menu-made/" target="_blank" rel="noopener" aria-label="LinkedIn">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM3 9h4v12H3V9zm6 0h4v1.6c.8-1.2 2-1.9 3.6-1.9 3.2 0 4.4 2 4.4 5.4V21h-4v-6.1c0-1.7-.3-2.8-1.8-2.8-1.6 0-2.2 1.2-2.2 2.8V21H9V9z"/></svg>
      </a>
      <a class="social-icon" href="https://www.instagram.com/menumade.gram/" target="_blank" rel="noopener" aria-label="Instagram">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm10 2H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm-5 4.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6zm0 2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM18 6.3a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z"/></svg>
      </a>
    </div>"""


def price(code, interval=None, bare=False):
    attrs = f' data-price-for="{code}"'
    if interval:
        attrs += f' data-price-interval="{interval}"'
    if bare:
        attrs += " data-price-bare"
    return f'<span class="mm-price"{attrs}>…</span>'


def nav_html(active):
    links = []
    for href, label in NAV:
        cls = ' class="active"' if href == active else ""
        links.append(f'<a{cls} href="{href}">{label}</a>')
    cta = ' class="nav-cta active"' if active == "contact.html" else ' class="nav-cta"'
    links.append(f'<a{cta} href="contact.html">Start</a>')
    return '<nav class="nav" id="primaryNav" aria-label="Primary">\n      ' + "\n      ".join(links) + "\n    </nav>"


def head(title, description, path, body_class, extra=""):
    url = "https://menu-made.com/" + ("" if path == "index.html" else path[:-5])
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Philosopher:wght@400;700&family=Aldrich&display=swap" rel="stylesheet">
  <link rel="icon" type="image/png" href="MENU=.png">
  <link rel="shortcut icon" href="MENU=.png">
  <link rel="apple-touch-icon" href="MENU=.png">
  <link rel="stylesheet" href="main.css?v={CSS_VERSION}">
  <script src="funnel.js?v=20261016-service-measurement" defer></script>
  <script src="site-nav.js?v=20261016-accessible-navigation" defer></script>
  {CATALOG_JS}
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="en_US">
  <meta property="og:site_name" content="MENU-MADE">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="https://menu-made.com/assets/social-preview.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="MENU-MADE — Menus, websites and Google care for local businesses">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{title}">
  <meta name="twitter:description" content="{description}">
  <meta name="twitter:image" content="https://menu-made.com/assets/social-preview.png">
{extra}</head>
<body class="{body_class}">
<a class="site-skip" href="#main-content">Skip to content</a>
<header class="header">
  <div class="container header-inner">
    <div class="brand">
      <a class="gear-link" href="index.html" aria-label="Home">
        <img src="MENU=.png" class="brand-mark" alt="Menu-Made gear">
      </a>
      <a class="word-link" href="about.html" aria-label="About">
        <img src="MENU1.png" class="brand-word" alt="Menu-Made">
      </a>
    </div>
    <button class="gear-burger" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Open navigation menu" hidden><img src="MENU=.png" alt="" aria-hidden="true"></button>
    {nav_html(path)}
  </div>
</header>
<main id="main-content" tabindex="-1">
"""


def foot(scripts=""):
    return f"""</main>
<footer class="footer">
  <div class="container footer-inner">
    <div class="footer-copy">© 2019–2026 MENU-MADE</div>
    <a class="footer-logo" href="index.html" aria-label="Home">
      <img src="MENU1.png" alt="MENU-MADE">
    </a>
{SOCIAL}
  </div>
  {FOOTER_LINKS}
</footer>
<script src="section-parallax.js?v=20261015-unified" defer></script>
{scripts}</body>
</html>
"""


def toggle(name):
    return f"""<fieldset class="mm-toggle" data-billing-toggle>
  <legend class="mm-sr">Billing</legend>
  <label><input type="radio" name="{name}" value="month" checked><span>Monthly</span></label>
  <label><input type="radio" name="{name}" value="year"><span>Yearly <em>2 months free</em></span></label>
</fieldset>"""


# ---------------------------------------------------------------- products
# One source for every product's words. Facts only: what the buyer gets, what they provide, how it is
# delivered. Anything a producer does not do (as built Oct 28, 2026) is not promised here.
PLANS = {
    "MENU_CARE": dict(
        name="Menu Care", anchor="menu-care", short="Unlimited menu updates, same QR code",
        gets=["Send changes any time from your private change link: dishes, prices, sections, specials",
              "Each update is checked against your request and approved by us before it goes live",
              "Your menu stays at the same address, so printed QR codes keep working",
              "A monthly email with one seasonal special idea built from your own menu",
              "Hosting for your Menu-Made menu included"],
        provide="Your changes, written the way you would tell a server. Works with a menu hosted by Menu-Made: start with Online Menu + QR if you don’t have one yet.",
        delivery="Every change is reviewed before it is published.",
    ),
    "REVIEW_REPLIES": dict(
        name="Review Replies", anchor="review-replies", short="Every new Google review answered",
        gets=["Each week we read your new Google reviews and write a reply in your voice",
              "4- and 5-star replies post automatically; 1- to 3-star replies are approved by a person first",
              "Replies never invent prices, hours or offers, and never promise refunds or discounts",
              "Replies you wrote yourself are never overwritten",
              "A weekly summary email: new reviews, replies and your rating trend"],
        provide="Connect your Google Business Profile once from the link we email you. Optional: tone, sign-off, how unhappy guests can reach you, topics to avoid.",
        delivery="Your first week covers reviews from the last 30 days.",
    ),
    "GOOGLE_PROFILE_CARE": dict(
        name="Google Profile Care", anchor="google-profile-care", short="A busy, up-to-date Google profile",
        gets=["A new Google post every week, written from your specials and profile, with a photo from your library",
              "Up to 3 photos from your library added to your profile each month",
              "Review replies, the same way as Review Replies (included)",
              "A monthly report: views in Search and Maps, calls, direction requests and website clicks, compared with the month before",
              "A weekly email showing what went live"],
        provide="Connect your Google profile once; add photos to your photo library; tell us your specials when you have them (optional).",
        delivery="Posts are checked so they only state facts you gave us; anything that fails the check is held back, not published.",
    ),
    "SOCIAL_POSTS": dict(
        name="Social Posts", anchor="social-posts", short="A month of posts, ready to share",
        gets=["12 posts a month planned from your real menu, specials and the season",
              "24 ready-to-post graphics (square feed and story sizes) with captions",
              "A posting calendar, delivered as one download",
              "Approved by us before it reaches you"],
        provide="Your voice and any specials on your plan settings page. You post them to Instagram, Facebook or wherever you like; we don’t log into your accounts.",
        delivery="Delivered at the start of each month.",
    ),
    "WEBSITE_CARE": dict(
        name="Website Care", anchor="website-care", short="Hosting and changes for your Menu-Made site",
        gets=["Hosting for the website Menu-Made built for you",
              "Changes on request from your private change link: menu or services, hours, phone, address, wording, style and colour",
              "Every change checked and approved before it goes live",
              "A monthly report from a daily check that your site is up and responding"],
        provide="Your change requests. New photos or new pages: reply to any of our emails and we’ll arrange it.",
        delivery="Covers websites built by Menu-Made only. Comes free for 3 months with the Website Package.",
    ),
    "ACCESSIBILITY_MONITORING": dict(
        name="Accessibility Monitoring", anchor="accessibility-monitoring", short="A monthly accessibility check of your site",
        gets=["A monthly scan of up to 10 pages of your website for common accessibility problems: images without descriptions, unlabeled form fields, heading order, unclear links, missing page language and more",
              "A plain-language report with issues ranked by importance and the fix for each",
              "A month-over-month trend so you can see progress"],
        provide="Your website address, entered on your plan settings page after checkout.",
        delivery="Sent automatically each month. Automated checks can’t judge everything (for example colour contrast or keyboard use), and the report is not a guarantee of legal compliance.",
    ),
    "GUEST_APP": dict(
        name="Guest App", anchor="guest-app", short="Your own app on guests’ phones",
        gets=["An app guests add to their home screen from your link or QR code: menu, specials, hours, location, call button and your ordering or reservation link",
              "Works offline once opened, on iPhone and Android",
              "Its own QR code for table tents and windows",
              "Update specials and your menu any time from your update link"],
        provide="Your logo and details. If Menu-Made built your website, the form arrives pre-filled.",
        delivery="Setup builds the app and we approve it before it goes live; the monthly plan keeps it hosted and updatable. This is an app installed from the browser, not an App Store download.",
    ),
}

BUNDLES = {
    "BUNDLE_STARTER": dict(name="Starter", tagline="Your menu current and every review answered.",
                           includes=["Menu Care", "Review Replies", "Accessibility Monitoring"]),
    "BUNDLE_GROWTH": dict(name="Growth", tagline="Everything in Starter, plus a busy Google profile.",
                          includes=["Menu Care", "Google Profile Care (with review replies)", "Accessibility Monitoring"], badge="Most popular"),
    "BUNDLE_PRO": dict(name="Pro", tagline="Your whole online presence, handled.",
                       includes=["Everything in Growth", "Social Posts", "Website Care"],
                       note="Website Care looks after a website Menu-Made built: add the Website Package if you need one."),
}

ONCE = {
    "ONLINE_MENU_QR": dict(
        name="Online Menu + QR", anchor="online-menu", service="menu",
        short="Your menu as a mobile page, plus a QR code for every table",
        gets=["A mobile menu page built from the PDF or photos of your current menu",
              "Your logo and colours (optional)",
              "A printable QR code that opens it",
              "First year of hosting and two revisions included"],
        provide="Your current menu as a PDF or photos, uploaded at checkout. That’s all we need before payment.",
        delivery="Checked and approved by us, then emailed to you. Up to 3 pages included; each extra page is <span data-menu-extra-page>extra</span>, and we check the page count of your file before we start. After the first year, hosting continues with Menu Care, which also keeps your menu up to date.",
    ),
    "WEBSITE_PACKAGE": dict(
        name="Website Package", anchor="website-package", service="website",
        short="A finished website, with 3 months of Website Care",
        gets=["A website of up to 5 pages: Home, Menu or Services, About, Gallery, Contact &amp; Hours",
              "Your choice of 9 styles, written from what you tell us about your business",
              "Live at yourname.menu-made.com once approved, and on your own domain when you point it to us",
              "3 months of Website Care included"],
        provide="A short form after checkout: your story, menu or services, hours, contact details, logo and up to 6 photos.",
        delivery="We approve it before it goes live. Not included: online ordering, booking systems, member areas, custom integrations or more than 5 pages.",
    ),
    "GOOGLE_VISIBILITY": dict(
        name="Google Visibility", anchor="google-visibility", service="google",
        short="A one-time tune-up of your Google profile",
        gets=["A score of your Google Business Profile on 11 checks",
              "Updates using details you’ve given us: description, website, phone, menu link, logo and photos",
              "A before-and-after report, plus a short to-do list for things only you can confirm (like hours)"],
        provide="Whether you have a profile already. New to Google? We guide you through creating and verifying it, then you connect it.",
        delivery="Changes are approved before they’re published. Google decides rankings, so placement isn’t guaranteed.",
    ),
    "CONVERSION_FIX": dict(
        name="Conversion Fix", anchor="conversion-fix", service="conversion",
        short="A clear fix list for your current website",
        gets=["A review of your homepage and up to 5 linked pages: speed, phone layout, calls to action, forms, trust signals and menu links",
              "A prioritized fix list with rewritten headlines and buttons and ready-to-use code snippets",
              "A checklist you or your web person can work through"],
        provide="Your website address and the one thing you want visitors to do (call, book, order).",
        delivery="Reviewed by us before it’s sent. You make the changes, or we build you a Website Package.",
    ),
}


def product_section(code, p, kind):
    gets = "".join(f"<li>{g}</li>" for g in p["gets"])
    if kind == "plan":
        price_line = f'{price(code)}'
        if code == "GUEST_APP":
            price_line += f' <span class="mm-plus">+ {price("GUEST_APP_SETUP")} setup</span>'
        cta = f'<a class="btn primary" data-plan-cta="{code}" data-cta-label="Choose {p["name"]}" href="contact.html?plan={code}">Choose {p["name"]}</a>'
    else:
        price_line = price(code)
        if code == "ONLINE_MENU_QR":
            price_line += ' <span class="mm-plus">first year, up to 3 pages</span>'
        cta = f'<a class="btn primary" data-plan-cta="{code}" data-cta-label="Start {p["name"]}" href="contact.html?service={p["service"]}">Start {p["name"]}</a>'
    return f"""<article class="mm-product" id="{p['anchor']}" aria-labelledby="{p['anchor']}-title">
  <header class="mm-product-head">
    <h3 id="{p['anchor']}-title">{p['name']}</h3>
    <p class="mm-product-short">{p['short']}</p>
    <p class="mm-product-price">{price_line}</p>
  </header>
  <div class="mm-product-body">
    <div><h4>You get</h4><ul class="mm-checks">{gets}</ul></div>
    <div><h4>You provide</h4><p>{p['provide']}</p><h4>How it’s delivered</h4><p>{p['delivery']}</p></div>
  </div>
  <div class="mm-product-actions">{cta}</div>
</article>
"""


def bundle_card(code, b, show_cta=True):
    items = "".join(f"<li>{i}</li>" for i in b["includes"])
    badge = f'<span class="mm-badge">{b["badge"]}</span>' if b.get("badge") else ""
    note = f'<p class="mm-note">{b["note"]}</p>' if b.get("note") else ""
    cta = f'<a class="btn primary" data-plan-cta="{code}" data-cta-label="Choose {b["name"]}" href="contact.html?plan={code}">Choose {b["name"]}</a>' if show_cta else ""
    featured = " is-featured" if b.get("badge") else ""
    return f"""<article class="mm-bundle{featured}" aria-labelledby="{code.lower()}-title">
  {badge}<h3 id="{code.lower()}-title">{b['name']}</h3>
  <p class="mm-bundle-tagline">{b['tagline']}</p>
  <p class="mm-bundle-price">{price(code)}</p>
  <p class="mm-saving" data-saving-for="{code}" hidden></p>
  <ul class="mm-checks">{items}</ul>
  {note}
  {cta}
</article>"""


def bundles_block(toggle_name):
    cards = "\n".join(bundle_card(c, b) for c, b in BUNDLES.items())
    return f"""{toggle(toggle_name)}
<p class="mm-annual-note" data-annual-note hidden>Yearly plans are billed once a year at 10× the monthly price.</p>
<div class="mm-bundles">
{cards}
</div>"""


FAQ = [
    ("How does it work after I pay?",
     "Checkout takes a minute and asks only what we need to start. Right after payment you get an email with your next step: a link to connect Google, a short form, or your settings page. The work then runs on schedule, and anything creative is approved by a person before it reaches you or goes public."),
    ("Can I change or cancel my plan?",
     "Yes. Every plan email has a link to your billing page, where you can switch to another plan, move between monthly and yearly billing, update your card, see invoices and cancel. Switching takes effect right away and is prorated; cancelling stops the plan at the end of the period you’ve paid for."),
    ("Monthly or yearly?",
     "Either. Yearly plans cost 10 times the monthly price, so you get 2 months free."),
    ("Do I need to give you my passwords?",
     "No. Google is connected through Google’s own sign-in screen, and you can remove our access from your Google account at any time. We never ask for website or email passwords."),
    ("Who writes the posts and replies?",
     "They are written with AI from the facts you give us and your Google profile, then checked automatically so they don’t invent prices, hours or offers. Low-star review replies and creative work are approved by a person before they go out."),
    ("Is there a contract?",
     "No long-term contract. Monthly plans renew monthly and yearly plans renew yearly until you cancel."),
    ("What if I just want one thing?",
     "Every plan can be bought on its own, and one-time services like Online Menu + QR, Google Visibility and the Website Package don’t need a plan."),
]


def faq_block():
    items = "\n".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in FAQ)
    return f'<div class="faq-list">\n{items}\n</div>'


def faq_jsonld():
    import json
    return '<script type="application/ld+json">' + json.dumps({
        "@context": "https://schema.org", "@type": "FAQPage",
        "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ],
    }) + "</script>\n"


def service_jsonld(name, description, url):
    import json
    return '<script type="application/ld+json">' + json.dumps({
        "@context": "https://schema.org", "@type": "Service", "name": name, "description": description,
        "provider": {"@type": "Organization", "name": "MENU-MADE", "url": "https://menu-made.com/"},
        "areaServed": "US", "url": url,
    }) + "</script>\n"


# ---------------------------------------------------------------- pages
def page_index():
    title = "MENU-MADE — Menus, Google and Websites for Local Restaurants"
    desc = "Monthly plans that keep your menu current, answer your Google reviews and keep your profile active. Built for independent restaurants and local businesses."
    body = f"""<section class="hero">
  <div class="container hero-grid">
    <div class="hero-copy">
      <span class="pill">For independent restaurants and local businesses</span>
      <h1>Your menu, Google profile and website, kept up to date for you</h1>
      <p class="hero-intro">Pick a monthly plan. We keep your menu current, answer your Google reviews, post for you every week and send you a report, with a person approving anything creative before it goes out.</p>
      <div class="hero-actions">
        <a class="btn primary" href="#plans">See the plans</a>
        <a class="btn ghost" href="contact.html?service=menu">Start with a menu</a>
      </div>
    </div>
    <div class="hero-visual">
      <div class="media-frame guest-menu-frame">
        <img src="home-digital-presence.webp" alt="Illustrative business owner reviewing a website across a laptop and smartphone" class="hero-image" width="1536" height="1024" fetchpriority="high">
      </div>
    </div>
  </div>
</section>

<section class="section section-image" id="plans" aria-labelledby="plans-title">
  <div class="container">
    <header class="section-head"><h2 id="plans-title">Three plans. Cancel any time.</h2><p>Each plan combines services that would cost more on their own. All prices in USD.</p></header>
    {bundles_block("billing-home")}
    <p class="conversion-help"><a href="plans.html">Compare every plan and service</a> · <a href="services.html">What each service does</a></p>
  </div>
</section>

<section class="section" aria-labelledby="how-title">
  <div class="container">
    <header class="section-head"><h2 id="how-title">How it works</h2><p>No calls to schedule. No passwords to share.</p></header>
    <div class="conversion-grid">
      <article class="service-card"><h3>1. Choose and pay</h3><p>Pick a plan or a single service. Checkout asks only what we need to start.</p></article>
      <article class="service-card"><h3>2. Connect or upload</h3><p>Right after payment, connect Google with one click or upload your menu. We email you the link.</p></article>
      <article class="service-card"><h3>3. It runs on schedule</h3><p>Weekly posts and replies, monthly reports and updates. Anything creative is approved by a person first.</p></article>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="once-title">
  <div class="container">
    <header class="section-head"><h2 id="once-title">Need one thing done?</h2><p>One-time services, no plan required.</p></header>
    <div class="cards">
      <article class="service-card"><h3>Online Menu + QR</h3><p>Your PDF or photo menu turned into a mobile menu page and a QR code for every table.</p><div class="service-bottom"><span class="price">{price("ONLINE_MENU_QR")}</span><a class="cta-pill" href="contact.html?service=menu">Start my menu</a></div></article>
      <article class="service-card"><h3>Website Package</h3><p>A finished website of up to 5 pages in your choice of 9 styles, with 3 months of Website Care.</p><div class="service-bottom"><span class="price">{price("WEBSITE_PACKAGE")}</span><a class="cta-pill" href="website-design.html">See the package</a></div></article>
      <article class="service-card"><h3>Google Visibility</h3><p>A one-time tune-up of your Google profile, with a before-and-after report.</p><div class="service-bottom"><span class="price">{price("GOOGLE_VISIBILITY")}</span><a class="cta-pill" href="google-visibility.html">See what we check</a></div></article>
      <article class="service-card"><h3>Conversion Fix</h3><p>A prioritized fix list for your current website, with rewritten copy and code snippets.</p><div class="service-bottom"><span class="price">{price("CONVERSION_FIX")}</span><a class="cta-pill" href="services.html#conversion-fix">See the details</a></div></article>
    </div>
  </div>
</section>

<section class="section restaurant-work" aria-labelledby="restaurant-work-title">
  <div class="container">
    <header class="section-head"><h2 id="restaurant-work-title">Design work from JP and Nino</h2><p>A café website, an artist’s portfolio and a diner’s menu from our project archive.</p></header>
    <div class="restaurant-work-grid">
      <a class="restaurant-work-card" href="work-marios.html"><img src="assets/work/marios-website.webp" width="1000" height="536" loading="lazy" alt="Archived Mario’s Café website design" class="work-preview-top"><span>Mario’s Café <small>Website design</small></span></a>
      <a class="restaurant-work-card" href="work-nino.html"><img src="assets/work/nino-website.webp?v=20261027" width="1000" height="544" loading="lazy" alt="Nino Battaglia graphic design and branding website, with the headline A Point of View and a collage of his artwork" class="work-preview-top"><span>Nino Battaglia <small>Portfolio website design</small></span></a>
      <a class="restaurant-work-card" href="work-pinecrest.html"><img src="assets/work/pinecrest-dinner-preview.webp" width="760" height="1425" loading="lazy" alt="Pinecrest Diner’s dinner and pasta menu design" class="work-preview-lower"><span>Pinecrest Diner <small>Digital menu render</small></span></a>
    </div>
    <p class="conversion-help"><a href="portfolio.html">Explore our work</a> · <a href="sample-menu.html">Try a sample online menu</a></p>
  </div>
</section>

<section class="section menu-faq" id="faq" aria-labelledby="faq-title">
  <div class="container"><header class="section-head"><h2 id="faq-title">Questions owners ask</h2></header>
{faq_block()}
  </div>
</section>

<section class="section section-image" aria-label="Call to action">
  <div class="container cta">
    <div><h2>Ready when you are</h2><p>Choose a plan, or send us a question first.</p></div>
    <div class="cta-actions"><a class="btn primary" href="plans.html">Choose a plan</a><a class="btn ghost" href="contact.html#inquiry">Ask a question</a></div>
  </div>
</section>
"""
    return head(title, desc, "index.html", "home-page", faq_jsonld()) + body + foot()


def page_plans():
    title = "Plans &amp; Pricing — MENU-MADE"
    desc = "Starter, Growth and Pro plans, every service on its own, and one-time setups. Monthly or yearly with 2 months free. Prices in USD."
    singles = "\n".join(f"""<article class="mm-single">
  <h3>{p['name']}</h3><p>{p['short']}.</p>
  <p class="mm-single-price">{price(code)}{' <span class="mm-plus">+ ' + price("GUEST_APP_SETUP") + ' setup</span>' if code == 'GUEST_APP' else ''}</p>
  <div class="mm-single-actions"><a class="cta-pill" href="services.html#{p['anchor']}">Details</a><a class="btn primary" data-plan-cta="{code}" data-cta-label="Choose" href="contact.html?plan={code}">Choose</a></div>
</article>""" for code, p in PLANS.items())
    once = "\n".join(f"""<article class="mm-single">
  <h3>{p['name']}</h3><p>{p['short']}.</p>
  <p class="mm-single-price">{price(code)}{' <span class="mm-plus">first year</span>' if code == 'ONLINE_MENU_QR' else ''}</p>
  <div class="mm-single-actions"><a class="cta-pill" href="services.html#{p['anchor']}">Details</a><a class="btn primary" data-plan-cta="{code}" data-cta-label="Start" href="contact.html?service={p['service']}">Start</a></div>
</article>""" for code, p in ONCE.items())
    rows = [
        ("Menu Care: unlimited menu updates", True, True, True),
        ("Review Replies: every Google review answered", True, True, True),
        ("Accessibility Monitoring: monthly site check", True, True, True),
        ("Google Profile Care: weekly posts, photos, monthly report", False, True, True),
        ("Social Posts: 12 posts a month", False, False, True),
        ("Website Care: hosting and changes for your Menu-Made site", False, False, True),
    ]
    tick = '<span aria-label="Included">✓</span>'
    dash = '<span aria-label="Not included">—</span>'
    table_rows = "\n".join(f"<tr><th scope=\"row\">{r[0]}</th>" + "".join(f"<td>{tick if c else dash}</td>" for c in r[1:]) + "</tr>" for r in rows)
    body = f"""<section class="hero mm-page-hero">
  <div class="container">
    <span class="pill">Plans &amp; pricing</span>
    <h1>Choose how much we take off your plate</h1>
    <p class="hero-intro">Three plans that bundle our monthly services for less, every service on its own, and one-time setups. One plan per checkout; switch or cancel any time from your billing page.</p>
  </div>
</section>

<section class="section section-image" id="bundles" aria-labelledby="bundles-title">
  <div class="container">
    <header class="section-head"><h2 id="bundles-title">Plans</h2></header>
    {bundles_block("billing-plans")}
  </div>
</section>

<section class="section" id="compare" aria-labelledby="compare-title">
  <div class="container">
    <header class="section-head"><h2 id="compare-title">What each plan includes</h2></header>
    <div class="mm-table-wrap"><table class="mm-compare">
      <thead><tr><th scope="col">Service</th><th scope="col">Starter</th><th scope="col">Growth</th><th scope="col">Pro</th></tr></thead>
      <tbody>{table_rows}
      <tr class="mm-compare-price"><th scope="row">Price</th><td>{price("BUNDLE_STARTER")}</td><td>{price("BUNDLE_GROWTH")}</td><td>{price("BUNDLE_PRO")}</td></tr></tbody>
    </table></div>
  </div>
</section>

<section class="section" id="single" aria-labelledby="single-title">
  <div class="container">
    <header class="section-head"><h2 id="single-title">Services on their own</h2><p>Monthly or yearly, using the same switch as the plans above.</p></header>
    <div class="mm-singles">
{singles}
    </div>
  </div>
</section>

<section class="section section-image" id="one-time" aria-labelledby="one-time-title">
  <div class="container">
    <header class="section-head"><h2 id="one-time-title">One-time services</h2><p>Pay once. Add any of them to a plan in the same checkout.</p></header>
    <div class="mm-singles">
{once}
    </div>
  </div>
</section>

<section class="section menu-faq" id="faq" aria-labelledby="faq-title">
  <div class="container"><header class="section-head"><h2 id="faq-title">Billing questions</h2></header>
{faq_block()}
  </div>
</section>
"""
    return head(title, desc, "plans.html", "plans-page", faq_jsonld()) + body + foot()


def page_services():
    title = "What Each Service Does — MENU-MADE"
    desc = "Menu Care, Review Replies, Google Profile Care, Social Posts, Website Care, Accessibility Monitoring, Guest App and one-time setups: what you get, what you provide and how it's delivered."
    monthly = "\n".join(product_section(c, p, "plan") for c, p in PLANS.items())
    once = "\n".join(product_section(c, p, "once") for c, p in ONCE.items())
    jump = " · ".join(f'<a href="#{p["anchor"]}">{p["name"]}</a>' for p in list(PLANS.values()) + list(ONCE.values()))
    body = f"""<section class="hero mm-page-hero">
  <div class="container">
    <span class="pill">Services</span>
    <h1>What each service does</h1>
    <p class="hero-intro">Exactly what you get, what we need from you and how it’s delivered. Every service runs on schedule; anything creative is approved by a person before it goes out.</p>
    <p class="mm-jump">{jump}</p>
    <div class="hero-actions">{toggle("billing-services")}</div>
  </div>
</section>

<section class="section" id="monthly" aria-labelledby="monthly-title">
  <div class="container">
    <header class="section-head"><h2 id="monthly-title">Monthly services</h2><p>Each one is also part of the <a href="plans.html">Starter, Growth and Pro plans</a>.</p></header>
    <div class="mm-products">
{monthly}
    </div>
  </div>
</section>

<section class="section section-image" id="setups" aria-labelledby="setups-title">
  <div class="container">
    <header class="section-head"><h2 id="setups-title">One-time services</h2></header>
    <div class="mm-products">
{once}
    </div>
  </div>
</section>

<section class="section" aria-label="Call to action">
  <div class="container cta">
    <div><h2>Not sure which one?</h2><p>Most restaurants start with Growth, or with Online Menu + QR if they don’t have a mobile menu yet.</p></div>
    <div class="cta-actions"><a class="btn primary" href="plans.html">Compare plans</a><a class="btn ghost" href="contact.html#inquiry">Ask us</a></div>
  </div>
</section>
"""
    return head(title, desc, "services.html", "services-page mm-services-page") + body + foot()


def detail_page(path, code, kind, title, desc, eyebrow, h1, intro, checklist_title, checklist, extra_section):
    p = (PLANS if kind == "plan" else ONCE)[code]
    cta_href = f"contact.html?plan={code}" if kind == "plan" else f"contact.html?service={p['service']}"
    unit = price(code)
    body = f"""<section class="hero"><div class="container service-detail-hero"><div class="service-lead-copy">
<span class="pill">{eyebrow}</span><h1>{h1}</h1>
<p class="service-lead-intro">{intro}</p>
<p class="service-price"><strong>{unit}</strong><span>{p['short']}</span></p>
<div class="hero-actions"><a class="btn primary" data-plan-cta="{code}" data-cta-label="Start {p['name']}" href="{cta_href}">Start {p['name']}</a><a class="btn ghost" href="contact.html#inquiry">Ask a question</a></div>
</div><aside class="service-profile-plan" aria-labelledby="checklist-title"><p class="service-eyebrow">What you get</p><h2 id="checklist-title">{checklist_title}</h2><ul>{''.join(f'<li>{c}</li>' for c in checklist)}</ul></aside></div></section>
<section class="section"><div class="container"><div class="mm-products">
{product_section(code, p, kind)}
</div></div></section>
{extra_section}
<section class="section"><div class="container cta"><div><h2>Ready to start?</h2><p>Checkout asks only what we need. Your next step arrives by email right after payment.</p></div><div class="cta-actions"><a class="btn primary" data-plan-cta="{code}" data-cta-label="Start {p['name']}" href="{cta_href}">Start {p['name']}</a><a class="btn ghost" href="plans.html">See all plans</a></div></div></section>
"""
    return head(title, desc, path, "service-detail-page", service_jsonld(p["name"], desc, "https://menu-made.com/" + path[:-5])) + body + foot()


def page_website():
    extra = """<section class="section"><div class="container service-preparation"><div><h2>What we’ll ask after checkout</h2><ul class="service-preparation-list"><li>Your business story in a few sentences, and anything you want on the About page.</li><li>Your menu or list of services, hours, phone, address and email.</li><li>Your logo and up to 6 photos (PNG, JPEG or WebP).</li><li>Your favourite of the 9 styles and a brand colour, or let us pick.</li><li>The name you want before .menu-made.com, and your own domain if you have one.</li></ul></div><aside class="service-scope-note"><h3>What it isn’t</h3><p>The package is a fixed-scope site of up to 5 pages. Online ordering, booking systems, member areas and custom integrations aren’t included.</p><p>After the 3 included months, Website Care continues at its monthly price unless you cancel. It covers hosting and changes on request.</p><a href="services.html#website-care">How Website Care works</a></aside></div></section>"""
    return detail_page("website-design.html", "WEBSITE_PACKAGE", "once",
                       "Website Package for Restaurants &amp; Local Businesses — MENU-MADE",
                       "A finished website of up to 5 pages in your choice of 9 styles, live on a menu-made.com address once approved and on your own domain when you point it. Includes 3 months of Website Care.",
                       "Website Package", "A finished website, without the back-and-forth",
                       "Tell us about your business in one short form. We build a site of up to 5 pages in the style you choose, check it, approve it and put it live, then keep it hosted and updated with Website Care.",
                       "Up to 5 pages", ["Home", "Menu or Services", "About", "Gallery", "Contact &amp; Hours"], extra)


def page_google():
    extra = """<section class="section"><div class="container service-preparation"><div><h2>The 11 checks</h2><ul class="service-preparation-list"><li>Business categories</li><li>Description</li><li>Phone number</li><li>Website</li><li>Address or service area</li><li>Opening hours</li><li>Holiday hours for the coming US holidays</li><li>Menu link, where Google offers one</li><li>Logo</li><li>At least 10 photos</li><li>Overall completeness score, before and after</li></ul></div><aside class="service-scope-note"><h3>Only what you’ve told us</h3><p>We change your profile only with details you’ve given Menu-Made, such as your website, menu, logo and photos, and nothing goes live until it’s approved. Categories and hours are left to you, with clear steps in your report.</p><p>Want your profile kept active every week? <a href="services.html#google-profile-care">Google Profile Care</a> picks up where this leaves off.</p></aside></div></section>"""
    return detail_page("google-visibility.html", "GOOGLE_VISIBILITY", "once",
                       "Google Visibility: Google Business Profile Tune-up — MENU-MADE",
                       "A one-time tune-up of your Google Business Profile: scored on 11 checks, updated with details you've given us, approved before publishing, with a before-and-after report.",
                       "Google Visibility · one-time", "Make your Google profile work for you",
                       "Connect your Google Business Profile with one click. We score it, improve it with details you’ve given us, approve the changes and send you a before-and-after report. No profile yet? We walk you through creating and verifying one.",
                       "A clear before and after", ["Profile scored on 11 checks", "Description, links, logo and photos updated", "Before-and-after report", "To-do list for what only you can confirm"], extra)


def page_accessibility():
    extra = """<section class="section"><div class="container service-preparation"><div><h2>What the monthly scan looks for</h2><ul class="service-preparation-list"><li>Images without text descriptions</li><li>Form fields without labels</li><li>Missing or out-of-order headings</li><li>Links and buttons without clear names</li><li>Missing page language and page titles</li><li>Zooming blocked on phones, and other common problems</li></ul></div><aside class="service-scope-note"><h3>Honest about its limits</h3><p>Automated checks find common problems quickly, but they can’t judge everything, such as colour contrast, keyboard use or content added by scripts. Each report says so. It isn’t a guarantee of legal compliance.</p><p>Included in every plan: <a href="plans.html">compare plans</a>.</p></aside></div></section>"""
    return detail_page("accessibility-services.html", "ACCESSIBILITY_MONITORING", "plan",
                       "Accessibility Monitoring for Your Website — MENU-MADE",
                       "A monthly scan of up to 10 pages of your website for common accessibility problems, with a plain-language report, ranked fixes and a month-over-month trend.",
                       "Accessibility Monitoring · monthly", "Find accessibility problems before your guests do",
                       "Every month we scan your website for common accessibility problems and send a plain-language report with the most important fixes first, so you or your web person know exactly what to change.",
                       "Every month", ["Up to 10 pages scanned", "Issues ranked by importance", "The fix for each issue", "Month-over-month trend"], extra)


def page_privacy():
    title = "Privacy Policy — MENU-MADE"
    desc = "How MENU-MADE collects, uses and protects information, including Google Business Profile data, payments and email."
    body = """<section class="hero mm-page-hero"><div class="container"><span class="pill">Privacy</span><h1>Privacy Policy</h1><p class="hero-intro">Last updated October 28, 2026. This policy explains what MENU-MADE (“we”, “us”) collects when you use menu-made.com and our services, why, and the choices you have.</p></div></section>
<section class="section"><div class="container mm-legal">
<h2>Who we are</h2>
<p>MENU-MADE provides menus, websites, Google Business Profile care and related services to businesses. Contact us at <a href="mailto:info@menu-made.com">info@menu-made.com</a>.</p>

<h2>What we collect</h2>
<ul>
<li><strong>Details you give us</strong>: your name, business name, email, phone, and the materials you send for your service, such as menus, logos, photos, website addresses, business hours and change requests.</li>
<li><strong>Payment details</strong>: payments are handled by Stripe. We receive the payment status, your billing contact details and the last digits of your card from Stripe; we never see or store your full card number.</li>
<li><strong>Google Business Profile data</strong>: if you connect your Google account, see the next section.</li>
<li><strong>Site usage</strong>: a random identifier kept only for your browsing session (not a cookie), the pages and services you view, and where you came from (for example a campaign link), so we can see which pages help people choose a service. We skip this entirely if your browser sends Global Privacy Control or Do Not Track. We don’t use advertising cookies.</li>
<li><strong>Email records</strong>: which service emails we sent you and whether they were delivered.</li>
</ul>

<h2>Google user data</h2>
<p>Some services (Review Replies, Google Profile Care and Google Visibility) need access to your Google Business Profile. You grant it through Google’s own sign-in screen, which asks for the “manage your business listings” permission (business.manage). With it we:</p>
<ul>
<li>read your business profile: name, address, phone, website, hours, description, categories, attributes, photos and reviews;</li>
<li>read your profile’s performance figures (views, calls, direction requests and website clicks) for your monthly report;</li>
<li>post replies to reviews, publish posts and photos, and update your description, website, phone, menu link and logo, but only as part of the service you bought and, where the service says so, after approval.</li>
</ul>
<p>We use Google user data only to provide the service you bought. We do not sell it, use it for advertising, or use it to train AI models. We share it only with the processors listed below as needed to provide the service. The text of reviews and your profile details are sent to our AI provider to draft replies, posts and descriptions; that provider does not use it to train its models.</p>
<p>We keep your Google access token encrypted. You can remove our access at any time at <a href="https://myaccount.google.com/permissions" rel="noopener">myaccount.google.com/permissions</a>; the service then pauses and we email you a link to reconnect. When your plan ends we stop using your Google data, and you can ask us to delete what we hold at any time.</p>
<p>MENU-MADE’s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

<h2>How we use information</h2>
<ul>
<li>To provide, deliver and support the services you buy, and to send you service emails such as connect links, approvals, reports and receipts.</li>
<li>To take payment and manage subscriptions.</li>
<li>To check our work and keep the services secure and working.</li>
<li>To understand which pages help people choose a service.</li>
</ul>

<h2>Who processes information for us</h2>
<ul>
<li><strong>Stripe</strong>: payments, invoices and the billing page.</li>
<li><strong>Cloudflare</strong>: website hosting, our database and file storage.</li>
<li><strong>Anthropic</strong>: the AI model that reads menus and drafts replies, posts, descriptions and reports.</li>
<li><strong>Resend</strong>: sending email.</li>
<li><strong>Google</strong>: the Business Profile APIs you connect.</li>
<li><strong>GitHub</strong>: turning the designs for your social posts and app icons into image files.</li>
</ul>

<h2>How long we keep it</h2>
<p>We keep order, payment and service records for as long as you’re a customer and for the period the law requires for business records. Materials you send for a service are kept while the service is active so we can keep your menu, website or app up to date. You can ask us to delete your information at any time; we’ll do so unless we must keep it by law.</p>

<h2>Your choices</h2>
<ul>
<li>Ask for a copy of your information, or ask us to correct or delete it, by emailing <a href="mailto:info@menu-made.com">info@menu-made.com</a>.</li>
<li>Remove Google access at any time from your Google account.</li>
<li>Switch or cancel a plan from your billing page link in any plan email.</li>
<li>California residents have the right to know, correct and delete personal information and not to be discriminated against for using these rights. We do not sell or share personal information for cross-context advertising.</li>
</ul>

<h2>Security</h2>
<p>We use encrypted connections, encrypt stored Google access, sign the private links we email you so they can’t be guessed, and limit who can approve and publish work.</p>

<h2>Children</h2>
<p>Our services are for businesses and are not directed at children under 13.</p>

<h2>Changes</h2>
<p>If we change this policy we’ll update the date above, and email active customers about important changes.</p>
</div></section>
"""
    return head(title, desc, "privacy.html", "legal-page") + body + foot()


def page_account():
    title = "Your Account — MENU-MADE"
    desc = "Sign in with your email to see your plans, orders, deliveries and the links to make changes. No password needed."
    body = """<section class="hero mm-page-hero"><div class="container">
<span class="pill">Your account</span>
<h1 id="accountTitle">Your Menu-Made account</h1>
<p class="hero-intro" id="accountIntro">Your plans, orders, deliveries and the links to make changes, in one place. No password: we email you a sign-in link.</p>
</div></section>

<section class="section" id="signIn" aria-labelledby="signInTitle"><div class="container mm-account-narrow">
  <form class="mm-card" id="signInForm" novalidate>
    <h2 id="signInTitle">Sign in</h2>
    <p>Enter the email you used at checkout. We’ll send a link that signs you in; it works once, for 20 minutes.</p>
    <div class="field"><label for="signInEmail">Email</label><input id="signInEmail" type="email" autocomplete="email" inputmode="email" maxlength="150" required></div>
    <button class="btn primary" id="signInBtn" type="submit">Email me a sign-in link</button>
    <p class="mini" id="signInStatus" role="status" aria-live="polite"></p>
  </form>
  <p class="mini">Only need your card, invoices or plan? <a id="billingLogin" href="https://billing.stripe.com/p/login/bJe28rgRl2FGaL22yd9IQ00" rel="noopener">Sign in to billing</a> with the same email.</p>
</div></section>

<section class="section" id="dashboard" hidden aria-labelledby="dashTitle"><div class="container">
  <div class="mm-account-head"><h2 id="dashTitle">Signed in as <span id="accountEmail"></span></h2><button class="btn secondary" id="signOutBtn" type="button">Sign out</button></div>
  <div id="accountBusinesses"></div>
  <h2>Plans</h2><div class="mm-account-list" id="accountPlans"></div>
  <h2>Orders</h2><div class="mm-account-list" id="accountOrders"></div>
  <h2>Deliveries</h2><div class="mm-account-list" id="accountDeliveries"></div>
  <p class="mini">Something missing or wrong? Reply to any of our emails or write to <a href="mailto:info@menu-made.com">info@menu-made.com</a>.</p>
</div></section>
"""
    return head(title, desc, "account.html", "account-page") + body + foot('<script src="account.js?v=20261028-accounts" defer></script>\n')


def page_start():
    src = (ROOT / "contact.html").read_text()
    inquiry = src[src.index('<section class="section section-image" id="inquiry"'):src.index("</main>")]
    inquiry = inquiry.replace(
        '<select id="inquiryService" name="service" required><option value="">Choose a service</option><option>Online Menu + QR</option><option>Conversion Fix</option><option>Google Visibility</option><option>Accessibility Upgrade</option><option value="website">Website Design &amp; Custom Builds</option><option value="app">Mobile app project</option><option value="Other project">Other project</option></select>',
        '<select id="inquiryService" name="service" required><option value="">Choose a topic</option><option>Plans and bundles</option><option>Online Menu + QR</option><option>Website Package</option><option>Google Visibility</option><option>Conversion Fix</option><option>Guest App</option><option value="Other project">Something else</option></select>')
    inquiry = inquiry.replace("Talk directly with MENU-MADE about your website, app, visibility, accessibility, or design project.", "Ask about a plan, a service, or whether we’re the right fit for your business.")
    inquiry = inquiry.replace("Have a question or need help choosing a service? Send your details and we’ll reply with the next steps.", "Have a question or need help choosing? Send your details and we’ll reply by email.")

    def plan_card(code, name, blurb, label):
        return f"""<article class="service-card mm-choice" data-code="{code}" data-kind="plan" data-name="{name}">
              <h3>{name}</h3><p>{blurb}</p>
              <div class="service-bottom"><span class="price">{price(code)}</span><button class="btn primary js-add" type="button" data-select-label="{label}" aria-pressed="false">Loading…</button></div>
            </article>"""

    def once_card(code, name, blurb, label, extra=""):
        return f"""<article class="service-card mm-choice" data-code="{code}" data-kind="once" data-name="{name}">
              <h3>{name}</h3><p>{blurb}</p>
              <div class="service-bottom"><span class="price">{price(code)}{extra}</span><button class="btn primary js-add" type="button" data-select-label="{label}" aria-pressed="false">Loading…</button></div>
            </article>"""

    bundle_cards = "\n            ".join(plan_card(c, b["name"] + " plan", b["tagline"] + " Includes " + ", ".join(b["includes"]) + ".", "Choose " + b["name"]) for c, b in BUNDLES.items())
    single_cards = "\n            ".join(plan_card(c, p["name"], p["short"] + "." + (" Includes the one-time app build." if c == "GUEST_APP" else ""), "Choose") for c, p in PLANS.items())
    once_cards = "\n            ".join(once_card(c, p["name"], p["short"] + ".", "Add", ' <small class="mm-plus">first year</small>' if c == "ONLINE_MENU_QR" else "") for c, p in ONCE.items())

    body = f"""<section class="hero" aria-label="Start">
  <div class="container hero-grid">
    <div class="hero-copy">
      <span class="pill">Start</span>
      <h1>Choose your plan</h1>
      <p>Pick one plan and any one-time services, then check out securely with Stripe. We only ask what we need to start; your next step arrives by email right after payment.</p>
      <div class="hero-actions">
        <a class="btn primary" href="#optionalServices" data-choose-services>Choose a plan or service</a>
        <a class="btn ghost" href="#inquiry">Questions first?</a>
      </div>
      <p class="conversion-help"><a href="plans.html">Compare plans</a> · <a href="services.html">What each service does</a></p>
    </div>
    <div class="hero-visual">
      <div class="media-frame">
        <img src="hospitality-owner.webp" alt="Illustrative restaurant owner preparing a menu at a café counter" class="hero-image hospitality-photo" width="1536" height="1024">
      </div>
    </div>
  </div>
</section>

<section class="section section-image" id="checkout" aria-label="Checkout">
  <div class="container">
    <header class="section-head"><h2>Your order</h2><p>One plan per order. Add one-time services alongside it.</p></header>
    <div class="start-grid">
      <details class="optional-services" id="optionalServices">
        <summary class="service-picker-summary" id="serviceChoicesSummary">
          <span class="service-picker-copy">
            <span class="service-picker-title">Choose a plan or service</span>
            <span class="service-picker-help">Tap or click to see everything</span>
          </span>
          <span class="service-picker-action" aria-hidden="true">
            <span class="service-picker-show">Show options</span>
            <span class="service-picker-hide">Hide options</span>
            <span class="service-picker-chevron"></span>
          </span>
        </summary>
        <div class="optional-content">
          {toggle("billing-start")}
          <section class="service-choice-group" aria-labelledby="bundleChoiceTitle">
            <h3 id="bundleChoiceTitle">Plans</h3>
            {bundle_cards}
          </section>
          <section class="service-choice-group" aria-labelledby="singleChoiceTitle">
            <h3 id="singleChoiceTitle">Services on their own</h3>
            {single_cards}
          </section>
          <section class="service-choice-group" aria-labelledby="onceChoiceTitle">
            <h3 id="onceChoiceTitle">One-time services</h3>
            {once_cards}
          </section>
        </div>
      </details>

      <aside class="cart" aria-label="Your order">
        <div class="cart-panel">
          <div class="cart-head"><div><h3>Your order</h3><p class="cart-sub">Review your choices and the total before checkout.</p></div></div>
          <ul class="cart-items" id="cartItems" aria-live="polite"></ul>
          <p class="mini" id="emptyOrder">Nothing chosen yet. Use “Choose a plan or service” to start.</p>
          <p class="mm-problem" id="orderProblem" role="alert" hidden></p>

          <div class="menu-config" id="menuConfig" hidden>
            <div class="field">
              <label for="menuPages">How many pages is your current menu?</label>
              <input id="menuPages" name="menu_pages" type="number" min="1" max="50" step="1" value="3" inputmode="numeric" aria-describedby="menuPagesHelp menuPagesError">
              <div class="mini" id="menuPagesHelp">Count every page of the menu you’ll upload. Up to 3 pages are included. We check the page count of your file; if it has more pages, we email you a link to pay the difference before we start.</div>
              <div class="validation-msg" id="menuPagesError" aria-live="polite"></div>
            </div>
            <dl class="menu-breakdown" aria-label="Menu price breakdown">
              <div><dt>Menu setup · up to 3 pages</dt><dd id="menuSetupAmount">—</dd></div>
              <div><dt>First-year hosting</dt><dd id="menuHostingAmount">—</dd></div>
              <div><dt id="extraPagesLabel">Additional pages · 0</dt><dd id="extraPagesAmount">—</dd></div>
            </dl>
          </div>

          <div class="cart-total" id="orderTotalRow" hidden>
            <span id="orderTotalLabel">Due today · USD</span>
            <strong id="cartTotal" aria-live="polite" aria-atomic="true">—</strong>
          </div>
          <p class="mm-recurring" id="recurringRow" hidden><span>Then</span> <strong id="recurringTotal"></strong></p>

          <div class="cart-actions" id="orderActions" hidden>
            <button class="btn primary" id="continueBtn" type="button" disabled>Continue to details</button>
            <button class="btn secondary" id="clearBtn" type="button" disabled>Clear</button>
          </div>
          <div class="status" id="status" role="status" aria-live="polite"></div>
          <details class="billing-details" id="billingDetails" hidden><summary>How billing works</summary><p class="mini">Today’s total covers your first month or year of the plan and any one-time services. Plans renew automatically. You can switch plans or cancel from the billing link in your plan emails; cancelling stops the plan at the end of the paid period. The Website Package includes 3 months of Website Care before its first charge. You’ll see the final total at Stripe before paying.</p></details>

          <div class="intake" id="intakeStep">
            <div class="two">
              <div class="field"><label for="lead_name">Your name *</label><input id="lead_name" maxlength="100" type="text" autocomplete="name" required></div>
              <div class="field"><label for="lead_business">Business name *</label><input id="lead_business" maxlength="150" type="text" autocomplete="organization" required></div>
            </div>
            <div class="two">
              <div class="field"><label for="lead_email">Email *</label><input id="lead_email" maxlength="150" type="email" autocomplete="email" inputmode="email" placeholder="name@business.com" required aria-describedby="lead_email_error"><div id="lead_email_error" class="validation-msg" aria-live="polite"></div></div>
              <div class="field"><label for="lead_phone">Phone (optional)</label><input id="lead_phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+1 555 555 5555" aria-describedby="lead_phone_error"><div id="lead_phone_error" class="validation-msg" aria-live="polite"></div></div>
            </div>

            <fieldset class="service-brief" id="conversionBrief" hidden>
              <legend>Conversion Fix</legend>
              <div class="field"><label for="conversionUrl">Current website *</label><input id="conversionUrl" type="url" maxlength="180" autocomplete="url" placeholder="https://yourbusiness.com" aria-describedby="conversionUrlError"><div class="validation-msg" id="conversionUrlError" aria-live="polite"></div></div>
              <div class="field"><label for="conversionGoal">Main thing visitors should do *</label><input id="conversionGoal" maxlength="80" placeholder="For example: call, book or order" aria-describedby="conversionGoalError"><div class="validation-msg" id="conversionGoalError" aria-live="polite"></div></div>
            </fieldset>
            <fieldset class="service-brief" id="googleBrief" hidden>
              <legend>Google Visibility</legend>
              <div class="field"><label for="googleMode">Do you have a Google Business Profile? *</label><select id="googleMode" aria-describedby="googleModeError"><option value="">Choose one</option><option value="existing">Yes, improve my profile</option><option value="new">No, help me create one</option></select><div class="validation-msg" id="googleModeError" aria-live="polite"></div></div>
              <div class="field" id="googleUrlField" hidden><label for="googleUrl">Profile link (optional)</label><input id="googleUrl" type="url" maxlength="180" placeholder="Paste your Google profile link" aria-describedby="googleUrlError"><div class="validation-msg" id="googleUrlError" aria-live="polite"></div></div>
            </fieldset>

            <div class="field">
              <label for="lead_document">Upload your current menu <span id="menuUploadNote" hidden>(PDF or photo; needed for Online Menu + QR)</span></label>
              <input id="lead_document" type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp" aria-describedby="lead_document_help lead_document_status">
              <div class="mini" id="lead_document_help">One PDF, Word document, text file, PNG, JPEG or WebP, up to 5 MB.</div>
              <div class="mini" id="lead_document_status" role="status" aria-live="polite"></div>
            </div>
            <div class="field"><label for="lead_notes">Anything we should know? (optional)</label><textarea id="lead_notes" maxlength="400" placeholder="Never send passwords."></textarea></div>

            <div class="checkline">
              <input id="scopeConfirm" type="checkbox" required>
              <label for="scopeConfirm" class="mini">I’ve read <a href="services.html">what’s included</a> and how billing works.</label>
            </div>
            <div class="cart-actions checkout-actions">
              <button class="btn primary" id="checkoutBtn" type="button">Proceed to secure checkout</button>
              <button class="btn secondary" id="backBtn" type="button">Hide details</button>
            </div>
            <div class="mini checkout-privacy-note">Your details are used to start and deliver your order. <a href="privacy.html">Privacy policy</a>.</div>
          </div>

          <p class="mini order-security" id="orderSecurity" hidden>Payment is handled by Stripe. MENU-MADE never sees your card details.</p>
        </div>
      </aside>
    </div>
  </div>
</section>

{inquiry}"""
    scripts = """<script src="document-upload.js?v=20261028-stage9" defer></script>
<script src="start.js?v=20261028-stage9" defer></script>
<script src="booking.js?v=20261016-buyer-flow" defer></script>
"""
    return head("Start — Choose Your Plan | MENU-MADE",
                "Choose a Starter, Growth or Pro plan, a single service or a one-time setup, review the total and check out securely with Stripe.",
                "contact.html", "start-page") + body + foot(scripts)


# ---------------------------------------------------------------- other pages: nav + footer only
def refresh_shared(path):
    src = (ROOT / path).read_text()
    src = re.sub(r'<nav class="nav" id="primaryNav"[^>]*>.*?</nav>', nav_html(path), src, count=1, flags=re.S)
    src = re.sub(r'<nav class="footer-links"[^>]*>.*?</nav>', FOOTER_LINKS, src, count=1, flags=re.S)
    src = re.sub(r'main\.css\?v=[\w-]+', f'main.css?v={CSS_VERSION}', src)
    (ROOT / path).write_text(src)


def main():
    pages = {
        "index.html": page_index(),
        "plans.html": page_plans(),
        "services.html": page_services(),
        "contact.html": page_start(),
        "privacy.html": page_privacy(),
        "account.html": page_account(),
        "website-design.html": page_website(),
        "google-visibility.html": page_google(),
        "accessibility-services.html": page_accessibility(),
    }
    for path, html in pages.items():
        (ROOT / path).write_text(html)
    for path in sorted(p.name for p in ROOT.glob("*.html")):
        if path not in pages and not path.startswith("checkout") and path != "sample-menu.html":
            refresh_shared(path)
    print("wrote", ", ".join(pages))


if __name__ == "__main__":
    main()
