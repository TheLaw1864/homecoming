# Where's Dakotah?

A countdown and live trip tracker for the family.

Hosted on Cloudflare Pages behind Cloudflare Access (email one-time PIN; @workflowgroup.com plus listed addresses).

- `index.html` - the public page. Shows the current or next trip, with the others under "Other trips".
- `admin.html` - add and edit trips, photos and settings. Saves to this repo through the GitHub API.
- `data/trips.json`, `data/site.json` - the content. `data/airports.json` - IATA code lookup (from mwgg/Airports).

Preview any moment with `?at=2026-09-28T14:30Z`.
