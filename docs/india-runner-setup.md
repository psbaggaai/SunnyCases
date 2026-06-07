# India Runner Setup

This repository is prepared to run the Bagga case refresh on GitHub Actions, but the workflow is intentionally pinned to a self-hosted runner with the labels:

`self-hosted`, `linux`, `x64`, `india`

That is the safest way to keep the scraping job off the local computer while still ensuring the outbound traffic originates from an India-based machine, which matters for the MP High Court site.

## Why this design

- GitHub-hosted runners do not guarantee India-based egress.
- Cloudflare cron jobs also do not guarantee India-based egress.
- A self-hosted runner on an India VM gives:
  - fixed India-region network origin
  - GitHub scheduling
  - browser automation with Playwright
  - no dependency on the local Mac being online

## Recommended host

Use any always-on Linux VM in India, for example:

- AWS Mumbai: `ap-south-1`
- GCP Mumbai: `asia-south1`
- Azure Central India

Ubuntu 22.04 or 24.04 is a good default.

## One-time setup on the India VM

1. Install system packages:

```bash
sudo apt update
sudo apt install -y git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

2. In GitHub, go to:

`BaggaCaseTracker` -> `Settings` -> `Actions` -> `Runners` -> `New self-hosted runner`

3. Choose Linux x64 and follow GitHub’s registration steps on the VM.

4. Add the runner label:

`india`

5. Clone this repository onto the VM and install dependencies once:

```bash
git clone https://github.com/psbaggaai/BaggaCaseTracker.git
cd BaggaCaseTracker
npm install
npx playwright install chromium
```

6. Add these GitHub Actions secrets to the repository:

- `GH_PAT`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The workflow file already reads those names.

## Schedule details

The workflow is scheduled in UTC:

- `30 0 * * *` = 6:00 AM IST
- `0 14 * * *` = 6:00 AM PST

## Manual test

After the runner is online:

1. Go to `Actions`
2. Open `Bagga Case Tracker Refresh`
3. Click `Run workflow`

## What the workflow does

- launches Playwright Chromium for the MP High Court records
- opens `https://mphc.gov.in/case-status`
- selects the case type, enters the case number and year, clicks search, and opens the matching MP High Court result
- refreshes the three Civil Court Khargone records that come from `https://mandleshwar.dcourts.gov.in/case-status-search-by-petitioner-respondent/`
- keeps the Khargone source route as `Party Name > Court Establishment > Civil Court Khargone > Kartar > 2024`, then refreshes each known CNR through the public eCourts CNR history endpoint
- collects modal, tab, district-court status, party, act, transfer, and history data
- rewrites `index.html`
- commits and pushes changes if data changed
- deploys to Cloudflare Pages
- verifies `https://baggacasetracker.pages.dev`
