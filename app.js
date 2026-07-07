const state = {
  records: [],
  expanded: new Set(),
};

const STATUS_CLASS = {
  IN_PROGRESS: "badge-in-progress",
  GENERATED: "badge-generated",
  LOW: "badge-low",
  FAILED: "badge-failed",
  EDITED: "badge-edited",
  NP_ASSIGNED: "badge-np-assigned",
  NP_IN_REVIEW: "badge-np-review",
  NP_REJECTED: "badge-np-rejected",
  PHYSICIAN_REVIEW: "badge-physician-review",
  COMPLETED: "badge-completed",
};

const TAG_CLASS = {
  IN_PROGRESS: "tag-warning",
  GENERATED: "tag-success",
  LOW: "tag-warning",
  FAILED: "tag-danger",
  EDITED: "tag-muted",
  NP_ASSIGNED: "tag-muted",
  NP_IN_REVIEW: "tag-warning",
  NP_REJECTED: "tag-danger",
  PHYSICIAN_REVIEW: "tag-warning",
  COMPLETED: "tag-success",
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const IST_OPTIONS = {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
};

const UTC_OPTIONS = {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
};

function formatTimeWithIst(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);

  const ist = date.toLocaleString("en-IN", IST_OPTIONS);
  const utc = date.toLocaleString("en-GB", UTC_OPTIONS);
  return `
    <div class="time-cell">
      <div>${escapeHtml(ist)} IST</div>
      <div class="time-sub">UTC ${escapeHtml(utc)}</div>
    </div>
  `;
}

function formatDateOnly(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

function badgeClass(status) {
  return STATUS_CLASS[status] || "badge-unpaired";
}

function tagClass(status) {
  return TAG_CLASS[status] || "tag-muted";
}

function noteField(record, pascalKey, legacyKey) {
  const value = record[pascalKey];
  if (value != null && value !== "") return value;
  return record[legacyKey];
}

function rowKey(record) {
  return noteField(record, "ReportRefId", "reportRefId") || "";
}

function billingPeriodLabel(record) {
  const bp = noteField(record, "BillingPeriod", "billingPeriod");
  if (!bp || typeof bp !== "object") return "—";
  const start = formatDateOnly(bp.Start ?? bp.start);
  const end = formatDateOnly(bp.End ?? bp.end);
  if (start === "—" && end === "—") return "—";
  return `${start} → ${end}`;
}

function monitoringLabel(record) {
  const minutes = noteField(record, "MonitoringMinutes", "monitoringMinutes");
  const days = noteField(record, "VitalsValidDays", "vitalsValidDays");
  if (minutes == null && days == null) return "—";
  const parts = [];
  if (minutes != null) parts.push(`${minutes} min`);
  if (days != null) parts.push(`${days} days vitals`);
  return parts.join(" · ");
}

function toUtcIsoDate(dateStr, endOfDay = false) {
  if (!dateStr) return "";
  const suffix = endOfDay ? "T23:59:59Z" : "T00:00:00Z";
  return `${dateStr}${suffix}`;
}

function buildQueryParams() {
  const params = new URLSearchParams();
  const status = $("status-filter").value;
  const orgId = $("org-filter").value.trim();
  const userId = $("user-filter").value.trim();
  const reportRefId = $("report-filter").value.trim();
  const mrn = $("mrn-filter").value.trim();
  const fromDate = $("from-date").value;
  const toDate = $("to-date").value;

  if (status) params.append("filter", `Status:${status}`);
  if (orgId) params.append("filter", `OrganizationId:${orgId}`);
  if (userId) params.append("filter", `UserId:${userId}`);
  if (reportRefId) params.append("filter", `ReportRefId:${reportRefId}`);
  if (mrn) params.append("filter", `Mrn:${mrn}`);
  if (fromDate || toDate) {
    const start = toUtcIsoDate(fromDate || "1970-01-01");
    const end = toUtcIsoDate(toDate || "2099-12-31", true);
    params.append("datespan", `CreatedAt:${start}...${end}`);
  }
  params.append("order", "CreatedAt:desc");
  params.append("limit", "2000");
  return params;
}

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    const data = await res.json();
    const stage = (data.stage || "sit").toUpperCase();
    const notesPath = data.mdb_notes_path || "/api/dozee/notes/query";
    $("mdb-endpoint-label").textContent = `${stage} · MDB: ${data.mdb_endpoint}${notesPath}`;
  } catch {
    $("mdb-endpoint-label").textContent = "MDB: proxy unavailable";
  }
}

async function loadRecords() {
  $("error-banner").classList.add("hidden");
  $("records-body").innerHTML = '<tr><td colspan="10" class="empty-row">Loading notes…</td></tr>';

  try {
    const res = await fetch(`/api/cpt-notes?${buildQueryParams().toString()}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    state.records = Array.isArray(data) ? data : [];
    state.expanded.clear();
    render();
    $("last-updated").textContent = `Updated ${new Date().toLocaleString()}`;
  } catch (err) {
    state.records = [];
    $("error-banner").textContent = `Failed to load CPT notes: ${err.message}`;
    $("error-banner").classList.remove("hidden");
    $("records-body").innerHTML = '<tr><td colspan="10" class="empty-row">No data</td></tr>';
    updateStats([]);
    $("visible-count").textContent = "0 shown";
  }
}

function filteredRecords() {
  const search = $("search-input").value.trim().toLowerCase();

  return state.records
    .slice()
    .sort((a, b) => {
      const aTime = noteField(a, "CreatedAt", "createdAt") || "";
      const bTime = noteField(b, "CreatedAt", "createdAt") || "";
      return String(bTime).localeCompare(String(aTime));
    })
    .filter((record) => {
      if (!search) return true;
      const haystack = [
        noteField(record, "ReportRefId", "reportRefId"),
        noteField(record, "Mrn", "mrn"),
        noteField(record, "UserId", "userId"),
        noteField(record, "OrganizationId", "organizationId"),
        noteField(record, "Status", "status"),
        noteField(record, "FailureReason", "failureReason"),
        noteField(record, "ActivityId", "activityId"),
        noteField(record, "ExistingReportRefId", "existingReportRefId"),
        noteField(record, "S3Url", "s3Url"),
        noteField(record, "HtmlS3Url", "htmlS3Url"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
}

function updateStats(records) {
  const counts = {
    total: records.length,
    IN_PROGRESS: 0,
    GENERATED: 0,
    LOW: 0,
    FAILED: 0,
  };
  for (const record of records) {
    const status = noteField(record, "Status", "status");
    if (status in counts) counts[status] += 1;
  }
  $("stat-total").textContent = counts.total;
  $("stat-in-progress").textContent = counts.IN_PROGRESS;
  $("stat-generated").textContent = counts.GENERATED;
  $("stat-low").textContent = counts.LOW;
  $("stat-failed").textContent = counts.FAILED;
}

function noteHasReport(record) {
  const status = noteField(record, "Status", "status");
  if (status === "IN_PROGRESS" || status === "FAILED") return false;
  return Boolean(noteField(record, "S3Url", "s3Url"));
}

function htmlViewUrl(reportRefId) {
  return `/api/cpt-notes/${encodeURIComponent(reportRefId)}/html/view`;
}

function renderNoteLinks(record) {
  const reportRefId = noteField(record, "ReportRefId", "reportRefId");
  if (!reportRefId || !noteHasReport(record)) {
    return "";
  }
  const href = htmlViewUrl(reportRefId);
  return `
    <div class="note-links">
      <a class="note-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">View HTML</a>
    </div>
  `;
}

function renderS3Link(label, uri) {
  if (!uri) {
    return `<div class="detail-row"><span class="muted">${escapeHtml(label)}</span><div>—</div></div>`;
  }
  return `
    <div class="detail-row">
      <span class="muted">${escapeHtml(label)}</span>
      <div class="mono s3-uri">${escapeHtml(uri)}</div>
    </div>
  `;
}

function renderEditedBy(editedBy) {
  if (!editedBy || typeof editedBy !== "object") return "—";
  const parts = [editedBy.Name, editedBy.Email, editedBy.Id].filter(Boolean);
  return parts.length ? escapeHtml(parts.join(" · ")) : escapeHtml(JSON.stringify(editedBy));
}

function renderEligibility(details) {
  if (!details || typeof details !== "object") {
    return '<p class="muted">No eligibility details</p>';
  }
  const rows = Object.entries(details)
    .map(
      ([key, value]) => `
        <div class="detail-row">
          <span class="muted">${escapeHtml(key)}</span>
          <div>${escapeHtml(value ?? "—")}</div>
        </div>
      `
    )
    .join("");
  return `<div class="detail-grid">${rows}</div>`;
}

function renderHistory(record) {
  const historyRaw = noteField(record, "History", "history");
  const history = Array.isArray(historyRaw) ? [...historyRaw].reverse() : [];
  const historyBlock = history.length
    ? `
      <div class="history-panel">
        <h3>History (${history.length} events)</h3>
        <div class="timeline">${history
          .map((entry) => {
            const status = entry.Status || entry.status || "—";
            const editedBy = entry.EditedBy || entry.editedBy
              ? `<div>Edited by: ${renderEditedBy(entry.EditedBy || entry.editedBy)}</div>`
              : "";
            const htmlUrl = entry.HtmlS3Url || entry.htmlS3Url
              ? `<div class="mono s3-uri">${escapeHtml(entry.HtmlS3Url || entry.htmlS3Url)}</div>`
              : "";
            const npAssigned = entry.NpName || entry.npName
              ? `<div>NP: ${escapeHtml(entry.NpName || entry.npName)}</div>`
              : "";
            const npRejected =
              entry.RejectReason || entry.rejectReason || entry.RejectedBy || entry.rejectedBy || entry.RejectedByRole || entry.rejectedByRole
                ? `
                  ${entry.RejectReason || entry.rejectReason ? `<div>Reason: ${escapeHtml(entry.RejectReason || entry.rejectReason)}</div>` : ""}
                  ${entry.RejectedBy || entry.rejectedBy ? `<div>Rejected by: ${escapeHtml(entry.RejectedBy || entry.rejectedBy)}</div>` : ""}
                  ${entry.RejectedByRole || entry.rejectedByRole ? `<div>Role: ${escapeHtml(entry.RejectedByRole || entry.rejectedByRole)}</div>` : ""}
                `
                : "";

            return `
              <div class="timeline-item timeline-item-cpt">
                <div class="timeline-time">${formatTimeWithIst(entry.Timestamp || entry.timestamp)}</div>
                <div class="timeline-event">
                  <span class="badge ${badgeClass(status)}">${escapeHtml(status)}</span>
                </div>
                <div class="timeline-detail">
                  ${editedBy}
                  ${htmlUrl}
                  ${npAssigned}
                  ${npRejected}
                </div>
              </div>
            `;
          })
          .join("")}</div>
      </div>
    `
    : '<div class="history-panel"><p class="muted">No history entries</p></div>';

  const detailsBlock = `
    <div class="detail-panel">
      <h3>Report Details</h3>
      <div class="detail-grid">
        <div class="detail-row">
          <span class="muted">Activity ID</span>
          <div class="mono">${escapeHtml(noteField(record, "ActivityId", "activityId") || "—")}</div>
        </div>
        <div class="detail-row">
          <span class="muted">Failure reason</span>
          <div>${escapeHtml(noteField(record, "FailureReason", "failureReason") || "—")}</div>
        </div>
        <div class="detail-row">
          <span class="muted">Existing report ref</span>
          <div class="mono">${escapeHtml(noteField(record, "ExistingReportRefId", "existingReportRefId") || "—")}</div>
        </div>
        <div class="detail-row">
          <span class="muted">Signing date</span>
          <div>${formatTime(noteField(record, "SigningDate", "signingDate"))}</div>
        </div>
      </div>
      <h3 class="detail-subheading">Report</h3>
      ${renderNoteLinks(record) || '<p class="muted">No report available</p>'}
      <h3 class="detail-subheading">S3 Locations</h3>
      ${renderS3Link("DOCX (S3Url)", noteField(record, "S3Url", "s3Url"))}
      ${renderS3Link("HTML cache (HtmlS3Url)", noteField(record, "HtmlS3Url", "htmlS3Url"))}
      ${renderS3Link("HTML source DOCX (HtmlSourceDocxUrl)", noteField(record, "HtmlSourceDocxUrl", "htmlSourceDocxUrl"))}
      <h3 class="detail-subheading">Eligibility</h3>
      ${renderEligibility(noteField(record, "EligibilityDetails", "eligibilityDetails"))}
    </div>
  `;

  return historyBlock + detailsBlock;
}

function render() {
  const records = filteredRecords();
  updateStats(state.records);
  $("visible-count").textContent = `${records.length} shown`;

  if (!records.length) {
    $("records-body").innerHTML = '<tr><td colspan="10" class="empty-row">No matching notes</td></tr>';
    return;
  }

  const rows = records
    .map((record) => {
      const key = rowKey(record);
      const expanded = state.expanded.has(key);
      const status = noteField(record, "Status", "status") || "unknown";

      const mainRow = `
        <tr>
          <td>
            <button class="expand-btn" data-key="${escapeHtml(key)}" aria-label="Toggle details">${expanded ? "−" : "+"}</button>
          </td>
          <td class="mono report-ref-cell">
            <div>${escapeHtml(noteField(record, "ReportRefId", "reportRefId") || "—")}</div>
            ${renderNoteLinks(record)}
          </td>
          <td>${escapeHtml(noteField(record, "Mrn", "mrn") || "—")}</td>
          <td class="mono">${escapeHtml(noteField(record, "UserId", "userId") || "—")}</td>
          <td class="mono">${escapeHtml(noteField(record, "OrganizationId", "organizationId") || "—")}</td>
          <td><span class="badge ${badgeClass(status)}">${escapeHtml(status)}</span></td>
          <td>${billingPeriodLabel(record)}</td>
          <td>${escapeHtml(monitoringLabel(record))}</td>
          <td>${formatTimeWithIst(noteField(record, "CreatedAt", "createdAt"))}</td>
          <td>${formatTime(noteField(record, "UpdatedAt", "updatedAt"))}</td>
        </tr>
      `;

      const detailRow = expanded
        ? `<tr class="history-row"><td colspan="10">${renderHistory(record)}</td></tr>`
        : "";

      return mainRow + detailRow;
    })
    .join("");

  $("records-body").innerHTML = rows;

  document.querySelectorAll(".expand-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      if (state.expanded.has(key)) state.expanded.delete(key);
      else state.expanded.add(key);
      render();
    });
  });
}

function bindEvents() {
  $("refresh-btn").addEventListener("click", loadRecords);
  $("status-filter").addEventListener("change", loadRecords);
  $("org-filter").addEventListener("change", loadRecords);
  $("user-filter").addEventListener("change", loadRecords);
  $("report-filter").addEventListener("change", loadRecords);
  $("mrn-filter").addEventListener("change", loadRecords);
  $("from-date").addEventListener("change", loadRecords);
  $("to-date").addEventListener("change", loadRecords);
  $("search-input").addEventListener("input", render);
}

async function init() {
  bindEvents();
  await loadConfig();
  await loadRecords();
}

init();
