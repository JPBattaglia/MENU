#!/usr/bin/env python3
"""Preview the proof-run QC, or execute that exact step with --execute."""
import argparse
import getpass
import json
import urllib.error
import urllib.request

RUN_ID = '6bcab908-a2d9-4320-a8e9-3208b9be1b66'
ENDPOINT = 'https://menu-made.com/api/production/run-next'

def call(secret, dry_run):
    payload = {'workflow_run_id': RUN_ID, 'step_key': 'QUALITY_CHECK', 'dry_run': dry_run}
    request = urllib.request.Request(ENDPOINT, data=json.dumps(payload).encode(),
        headers={'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError('Runner returned HTTP ' + str(error.code) + ': ' + error.read().decode()[:2000]) from None

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true', help='Preview first, then execute only the matched QC step.')
    args = parser.parse_args()
    secret = getpass.getpass('Existing PRODUCTION_RUNNER_SECRET (hidden): ').strip()
    if not secret:
        raise RuntimeError('No runner secret entered. Nothing was submitted.')
    preview = call(secret, True)
    print(json.dumps(preview, indent=2))
    if not (preview.get('ok') is True and preview.get('dry_run') is True and preview.get('processed') is False
            and preview.get('workflow_run', {}).get('id') == RUN_ID
            and preview.get('workflow_run', {}).get('workflow_key') == 'MENU_QR_V1'
            and preview.get('selected_step', {}).get('key') == 'QUALITY_CHECK'
            and preview.get('selected_step', {}).get('status') == 'QUEUED'):
        raise RuntimeError('The exact queued proof QC was not confirmed. No execution requested.')
    if args.execute:
        result = call(secret, False)
        print(json.dumps(result, indent=2))
        if not (result.get('ok') is True and result.get('processed') is True
                and result.get('workflow_run', {}).get('id') == RUN_ID
                and result.get('completed_step', {}).get('key') == 'QUALITY_CHECK'
                and result.get('completed_step', {}).get('status') == 'SUCCEEDED'):
            raise RuntimeError('QC success was not confirmed. Preserve the output for diagnosis; do not reset workflows.')
        print('Exact-run structural/integrity QC succeeded. Packaging and final review remain pending; CP-2 is still open.')
    else:
        print('Preview only. No workflow or asset was changed.')

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, urllib.error.URLError, TimeoutError, ValueError) as error:
        raise SystemExit(str(error)) from None
