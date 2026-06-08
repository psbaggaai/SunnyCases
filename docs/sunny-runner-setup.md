# Sunny Runner Setup

Sunny Case Tracker uses the same India self-hosted GitHub Actions runner as Bagga Case Tracker.

## Schedule

The workflow runs at the same UTC times as Bagga:

- `30 0 * * *` = 6:00 AM IST
- `0 14 * * *` = 6:00 AM Pacific standard time

The AWS EventBridge schedules that already start the Mumbai EC2 runner for Bagga can be reused. No separate VM is required.

## What The Sunny Job Does

1. Runs on the `self-hosted`, `linux`, `x64`, `india` runner.
2. Probes official Supreme Court of India pages for case status, AOR code, daily orders, judgments, office reports, and cause lists.
3. Detects CAPTCHA-gated official forms and records them as manual-refresh targets.
4. Fetches the known public source pages and direct PDF URLs already present in the Sunny case dataset.
5. Fingerprints source content, extracts lightweight date/text hints where possible, and writes `automation-events.json`.
6. Rebuilds the Sunny static site.
7. Commits and pushes refresh output.
8. Deploys the site to Cloudflare Pages project `sunnycasetracker`.

## CAPTCHA Policy

The scheduled automation does not solve or bypass CAPTCHA challenges. It records which official pages require CAPTCHA so the site can show where a manual official refresh is still needed.

## Required Repository Secrets

- `GH_PAT`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The workflow maps `GH_PAT` into `GITHUB_PAT` for the publish script.
