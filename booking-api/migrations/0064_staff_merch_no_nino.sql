-- Staff merch is logo merch only (owner, Nov 18, 2026: shirts in Nino's designs taken off the staff merch page).
UPDATE offers
SET description = 'Your logo on staff shirts, aprons, hats, mugs, coasters and more, printed and shipped by Printful',
    short_description = 'Your logo on staff shirts, aprons, hats and more',
    updated_at = '2026-11-18T00:00:00.000Z'
WHERE code = 'STAFF_MERCH';
