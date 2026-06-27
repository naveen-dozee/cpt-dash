# CPT Notes Dashboard

Internal dashboard for tracking `dozee.notes` MDB records — CPT 99091 report status, full history audit trail, and raw S3 locations.

## Run locally

```bash
cd cpt-dash
python3 server.py
```

Open [http://localhost:8770](http://localhost:8770) or [https://cpt-dash.dozee.int](https://cpt-dash.dozee.int) (via Caddy; see `../caddy/README.md`).

Edit `MDB_ENDPOINT` at the top of `server.py` to point at a different environment.

The server serves static files and proxies MDB queries at `/api/cpt-notes` to avoid browser CORS issues.

## Features

- Summary counts for `IN_PROGRESS`, `GENERATED`, `LOW`, and `FAILED`
- Filter by status, organization ID, user ID, report ref ID, and created date range
- Search across MRN, report ref, user, org, failure reason, S3 URIs
- Expandable rows with:
  - Full `history` timeline (`status`, `timestamp`, `editedBy`, `htmlS3Url` for edits)
  - S3 locations: `s3Url` (DOCX), `htmlS3Url`, `htmlSourceDocxUrl`
  - Failure reason, activity ID, eligibility details, signing date

## Data source

```
GET {MDB_ENDPOINT}/api/dozee/notes/query
```

Unlike the public API (`/api/v1/cpt/notes/*`), this dashboard reads raw MDB documents — S3 URIs and full history are not stripped.

### History statuses

| Status | Meaning |
| ------ | ------- |
| `IN_PROGRESS` | Generation started |
| `GENERATED` | DOCX uploaded to S3 |
| `LOW` | Generated but &lt; 30 monitoring minutes |
| `FAILED` | Error during generation or validation |
| `EDITED` | HTML edit saved (includes `editedBy` + versioned `htmlS3Url`) |
