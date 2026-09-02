import {
    hydrateWorkspaceSubmission,
} from "@/services/tempCounterProposal.js";
import {
    getAllCommissionerSubmissionTableRows,
    getSubmissionTableRowById,
} from "@/services/submissionListsApi.js";
import { subscribeRealtimeInvalidation } from "@/lib/realtime/realtimeInvalidation.js";
import {
    getWorkspaceReviewInvalidationKeys,
    WORKSPACE_LIST_INVALIDATION_KEYS,
} from "@/lib/realtime/workspaceRealtime.js";
import {
    getWorkspaceSubmissionStatus,
    patchWorkspaceSubmissionStatus,
} from "@/services/workspaceStatusApi.js";
import * as archiveRequestApi from "@/services/archiveRequestApi.js";

const DURABLE_STATUS_WRITES = new Set(["accepted", "rejected"]);

export { getWorkspaceSubmissionStatus };


function handleResponse(res) {
    if (!res.ok) {
        return res.json().catch(() => ({})).then((body) => {
            const message = body?.error || `Request failed (${res.status})`;
            throw new Error(message);
        });
    }
    return res.json();
}


export async function getWorkspaceComments(submissionId) {
    const res = await fetch(`/api/workspace/comments/${submissionId}`, {
        method: "GET",
        credentials: "include",
    });

    return handleResponse(res);
}

export async function getWorkspaceLabels(submissionId) {
    const res = await fetch(`/api/workspace/labels/${submissionId}`, {
        method: "GET",
        credentials: "include",
    });

    return handleResponse(res);
}


export async function addWorkspaceLabels(submissionId, labels) {
    const res = await fetch(`/api/workspace/labels/${submissionId}`, {
        method: "PUT",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            labels,
        }),
    });

    return handleResponse(res);
}

export async function createArchiveRequest(submissionId, assignees, options = {}) {
    return archiveRequestApi.createArchiveRequest(submissionId, assignees, options);
}

export async function getArchiveRequest(submissionId) {
    return archiveRequestApi.getArchiveRequest(submissionId);
}

export async function voteArchiveRequest(submissionId, vote, options = {}) {
    const current = options.request
        ?? await archiveRequestApi.getArchiveRequest(submissionId);
    if (!current?.id) {
        throw new Error("Archive request not found.");
    }
    return archiveRequestApi.voteArchiveRequest(current.id, vote, {
        expectedVersion: options.expectedVersion ?? current.version,
    });
}

export async function cancelArchiveRequest(submissionId, options = {}) {
    const current = options.request
        ?? await archiveRequestApi.getArchiveRequest(submissionId);
    if (!current?.id) {
        throw new Error("Archive request not found.");
    }
    return archiveRequestApi.cancelArchiveRequest(current.id, {
        expectedVersion: options.expectedVersion ?? current.version,
    });
}

export async function getWorkspaceLabelCatalog(submissionId) {
    const res = await fetch(`/api/workspace/label-catalog?submissionId=${encodeURIComponent(submissionId)}`, {
        method: "GET",
        credentials: "include",
    });

    return handleResponse(res);
}


export async function updateWorkspaceLabelCatalog(labelId, submissionId, changes) {
    const res = await fetch(`/api/workspace/label-catalog/${encodeURIComponent(labelId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...changes, submissionId }),
    });

    return handleResponse(res);
}

export const WORKSPACE_STATUS = Object.freeze({
    PENDING: "pending",
    ARCHIVE_REQUEST: "archive-request",
    ACCEPTED: "accepted",
    REJECTED: "rejected",
    ARCHIVED: "archived",
});

export function normalizeWorkspaceStatus(value) {
    const status = String(value ?? WORKSPACE_STATUS.PENDING)
        .trim()
        .toLowerCase()
        .replaceAll("_", "-")
        .replaceAll(" ", "-");

    if (["accepted", "approved", "addressed"].includes(status)) return WORKSPACE_STATUS.ACCEPTED;
    if (["under-review", "under_review"].includes(status)) return WORKSPACE_STATUS.PENDING;
    if (status === "rejected") return WORKSPACE_STATUS.REJECTED;
    if (["archive-request", "archive-requested"].includes(status)) {
        return WORKSPACE_STATUS.ARCHIVE_REQUEST;
    }
    if (["archived", "archive", "achived"].includes(status)) return WORKSPACE_STATUS.ARCHIVED;
    return WORKSPACE_STATUS.PENDING;
}

function normalizeSubmission(submission, source) {
    const resourceVersion = Number(
        submission.resource_version ?? submission.version ?? submission.resourceVersion,
    );

    return {
        ...submission,
        source,
        status: normalizeWorkspaceStatus(submission.status),
        resource_version: Number.isInteger(resourceVersion) && resourceVersion > 0
            ? resourceVersion
            : 1,
        crossProvinceWarning: submission.crossProvinceWarning
            ?? submission.cross_province_warning
            ?? null,
        scope_pruids: Array.isArray(submission.scope_pruids) ? submission.scope_pruids : [],
        authorEmail:
            submission.profile?.email ?? submission.authorEmail ?? "Unknown",
        profile: submission.profile ?? (submission.authorEmail ? { email: submission.authorEmail } : null),
    };
}

export async function createWorkspaceLabelCatalog(submissionId, label) {
    const res = await fetch("/api/workspace/label-catalog", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...label, submissionId }),
    });
    return handleResponse(res);
}

export async function deleteWorkspaceLabelCatalog(labelId, submissionId) {
    const res = await fetch(`/api/workspace/label-catalog/${encodeURIComponent(labelId)}?submissionId=${encodeURIComponent(submissionId)}`, {
        method: "DELETE",
        credentials: "include",
    });
    return handleResponse(res);
}

/**
 * REUSED API: live comments and objections are read through the existing
 * authenticated GET /api/comments route. Counter-proposals are loaded from the
 * dedicated submissions API so revision geometry is available for review.
 */
export async function getWorkspaceSubmissions({ includeArchived = true, signal } = {}) {
    const { items } = await getAllCommissionerSubmissionTableRows({}, { signal, pageSize: 100 });

    const submissions = items
        .map((submission) => normalizeSubmission(submission, "supabase"))
        .filter((submission) => includeArchived || submission.status !== WORKSPACE_STATUS.ARCHIVED)
        .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));

    return submissions;
}

export async function getCommissionerSubmissionRows() {
    return getWorkspaceSubmissions({ includeArchived: true });
}

export async function getWorkspaceReviewerEmails() {
    // HARD API: this only reuses commissioner profile records and performs no
    // Workspace write. The caller keeps the signed-in reviewer as a fallback.
    const response = await fetch("/api/workspace/reviewers", {
        credentials: "include",
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to load workspace reviewers.");
    }

    const emails = await response.json();
    return Array.isArray(emails)
        ? [...new Set(emails.map((email) => String(email).trim()).filter(Boolean))]
        : [];
}

export async function getWorkspaceSubmission(submissionId, options = {}) {
    const row = await getSubmissionTableRowById(submissionId);
    const submission = row ? normalizeSubmission(row, "supabase") : null;

    if (!submission || options.hydrateGeometry === false) return submission ?? null;
    return hydrateWorkspaceSubmission(submission, options.profilesByDguid);
}

/** Local-only review draft; not a shared or durable Workspace backend record. */
export async function getWorkspaceReviewState(submissionId) {
    const response = await fetch(`/api/workspace/submissions/${encodeURIComponent(submissionId)}/review-state`, {
        credentials: "include",
    });
    if (response.ok) {
        return response.json();
    }

    let collaborationWarning = "";
    const tolerateMissingLabelMigration = (promise) => promise.catch((error) => {
        if (/workspace label migration is not installed/i.test(error.message)) {
            collaborationWarning = error.message;
            return [];
        }
        throw error;
    });

    const [
        comments,
        labels,
        archiveRequest,
        labelCatalog,
    ] = await Promise.all([
        getWorkspaceComments(submissionId),
        tolerateMissingLabelMigration(getWorkspaceLabels(submissionId)),
        getArchiveRequest(submissionId).catch((error) => {
            if (error.status === 404) return null;
            throw error;
        }),
        tolerateMissingLabelMigration(getWorkspaceLabelCatalog(submissionId)),
    ]);
    return {
        comments,
        labels,
        labelCatalog,
        archiveRequest,
        collaborationWarning,
    };
}

export function subscribeWorkspaceState(listener, keys = "workspace:*") {
    if (typeof window === "undefined") return () => { };
    const handleFocus = () => listener();
    const handleVisibility = () => {
        if (document.visibilityState === "visible") listener();
    };
    const unsubscribeRealtime = subscribeRealtimeInvalidation(keys, listener);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleVisibility);
        unsubscribeRealtime();
    };
}

export function subscribeWorkspaceListState({ onInvalidate, onRecover = onInvalidate }) {
    if (typeof window === "undefined") return () => { };
    let recoverTimer = null;
    let recoverInFlight = null;

    const scheduleRecover = (payload) => {
        if (recoverTimer) window.clearTimeout(recoverTimer);
        recoverTimer = window.setTimeout(() => {
            recoverTimer = null;
            if (recoverInFlight) return;
            recoverInFlight = Promise.resolve(onRecover(payload))
                .catch(() => {})
                .finally(() => { recoverInFlight = null; });
        }, 150);
    };

    const handleFocus = () => scheduleRecover({ event: null, reason: "focus", resync: true });
    const handleVisibility = () => {
        if (document.visibilityState === "visible") {
            scheduleRecover({ event: null, reason: "visibility", resync: true });
        }
    };
    const unsubscribeRealtime = subscribeRealtimeInvalidation(
        WORKSPACE_LIST_INVALIDATION_KEYS,
        onInvalidate,
    );
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
        if (recoverTimer) window.clearTimeout(recoverTimer);
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleVisibility);
        unsubscribeRealtime();
    };
}

export function subscribeWorkspaceReviewState(
    submissionId,
    { onInvalidate, onRecover = onInvalidate },
) {
    if (typeof window === "undefined") return () => { };
    const handleFocus = () => onRecover({ event: null, reason: "focus", resync: true });
    const handleVisibility = () => {
        if (document.visibilityState === "visible") {
            onRecover({ event: null, reason: "visibility", resync: true });
        }
    };
    const unsubscribeRealtime = subscribeRealtimeInvalidation(
        getWorkspaceReviewInvalidationKeys(submissionId),
        onInvalidate,
    );
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleVisibility);
        unsubscribeRealtime();
    };
}


export async function saveWorkspaceLabels(submissionId, labels) {
    const normalizedLabels = labels.map((label) => ({
        id: String(label.id),
        key: String(label.key ?? label.catalogId ?? label.id),
        name: String(label.name).trim(),
        color: String(label.color),
        custom: Boolean(label.custom),
    }));

    return addWorkspaceLabels(submissionId, normalizedLabels);
}

export async function saveWorkspaceLabelCatalog(labelId, submissionId, changes) {
    return updateWorkspaceLabelCatalog(labelId, submissionId, {
        ...(Object.hasOwn(changes, "name") ? { name: String(changes.name ?? "").trim() } : {}),
        ...(Object.hasOwn(changes, "color") ? { color: String(changes.color ?? "").trim() } : {}),
    });
}

export async function addWorkspaceComment(submissionId, { content, is_closing = false, action = null }) {
    const res = await fetch(`/api/workspace/comments/`, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            submissionId,
            content,
            action,
            is_closing,
        }),
    });

    return handleResponse(res);
}

export async function updateWorkspaceComment(commentId, updates) {
    const res = await fetch(`/api/workspace/comments/${encodeURIComponent(commentId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
    });
    return handleResponse(res);
}

export async function deleteWorkspaceComment(commentId) {
    const res = await fetch(`/api/workspace/comments/${encodeURIComponent(commentId)}`, {
        method: "DELETE",
        credentials: "include",
    });
    return handleResponse(res);
}

export async function deleteWorkspaceLabel(labelId) {
    const res = await fetch(`/api/workspace/labels/${encodeURIComponent(labelId)}`, {
        method: "DELETE",
        credentials: "include",
    });
    return handleResponse(res);
}

export async function updateWorkspaceArchiveAssigneesById(requestId, assignees, { expectedVersion } = {}) {
    return archiveRequestApi.updateArchiveRequestAssignees(requestId, assignees, { expectedVersion });
}

export async function updateWorkspaceArchiveAssignees(submissionId, assignees) {
    const current = await archiveRequestApi.getArchiveRequest(submissionId);
    if (!current?.id) {
        throw new Error("Archive request not found.");
    }
    return updateWorkspaceArchiveAssigneesById(current.id, assignees, {
        expectedVersion: current.version,
    });
}

async function persistLiveStatus(submission, status) {
    if (submission?.source !== "supabase") {
        throw new Error("Only persisted submissions can change Workspace status.");
    }

    const expectedVersion = Number(submission.resource_version);
    const persisted = await patchWorkspaceSubmissionStatus(submission.id, {
        status,
        ...(Number.isInteger(expectedVersion) && expectedVersion > 0
            ? { expectedVersion }
            : {}),
    });

    return {
        ...persisted,
        resource_version: Number(persisted?.version) || expectedVersion || 1,
    };
}

/**
 * Durable accepted/rejected writes via the CP4 Workspace status API.
 * Archive-owned statuses are owned by Archive Request / archive transactions.
 */
export async function setWorkspaceSubmissionStatus(submission, status) {
    const normalizedStatus = normalizeWorkspaceStatus(status);
    if (!DURABLE_STATUS_WRITES.has(normalizedStatus)) {
        throw new Error(
            "Archive-owned statuses cannot be written through the Workspace status route.",
        );
    }

    const persisted = await persistLiveStatus(submission, normalizedStatus);
    if (submission && persisted?.resource_version) {
        submission.resource_version = persisted.resource_version;
    }
    return normalizeWorkspaceStatus(persisted?.status ?? normalizedStatus);
}

async function persistArchiveMerge(submission, closingComment) {
    if (submission?.source !== "supabase") {
        throw new Error("Temporary counter-proposals cannot be merged until their Supabase write protocol is available.");
    }

    // HARD API: archive persistence requires the archive_tree bootstrap table.
    const response = await fetch("/api/workspace/archive", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: submission.id, closingComment }),
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to merge into the archive tree.");
    }
}

function actionDescription(action, email) {
    const descriptions = {
        accept: `${email} accepted this submission.`,
        reject: `${email} rejected this submission.`,
        "reject-again": `${email} rejected this submission again.`,
        "accept-again": `${email} accepted this submission again.`,
        "archive-request": `${email} requested that this submission be archived.`,
        "archive-cancel": `${email} cancelled the archive request.`,
        "archive-vote-accept": `${email} approved the archive request.`,
        "archive-vote-reject": `${email} rejected the archive request.`,
        "archive-merge": `${email} merged this submission into the archive tree.`,
    };
    return descriptions[action] ?? `${email} updated this submission.`;
}

/**
 * Transitional decision orchestrator. Archive merge is durable for Supabase
 * submissions; comments, labels, and archive-request votes remain local drafts.
 */
export async function commitWorkspaceAction(submission, {
    action,
    email,
    message,
    assignees = [],
}) {
    const normalizedMessage = String(message ?? "").trim();
    if (!normalizedMessage) throw new Error("A commit message is required.");

    const reviewerEmail = String(email || "commissioner@example.com");
    let nextStatus = submission.status;

    if (action === "accept" || action === "accept-again") nextStatus = WORKSPACE_STATUS.ACCEPTED;
    if (action === "reject" || action === "reject-again") nextStatus = WORKSPACE_STATUS.REJECTED;
    if (action === "archive-request") nextStatus = WORKSPACE_STATUS.ARCHIVE_REQUEST;
    if (action === "archive-cancel" || action === "archive-vote-reject") {
        nextStatus = WORKSPACE_STATUS.ACCEPTED;
    }
    if (action === "archive-merge") nextStatus = WORKSPACE_STATUS.ARCHIVED;

    if (action === "archive-request") {
        await createArchiveRequest(
            submission.id,
            [...new Set(assignees)],
            { expectedVersion: submission.resource_version },
        );
    } else if (action === "archive-vote-accept") {
        await voteArchiveRequest(
            submission.id,
            "accepted",
        );
    } else if (action === "archive-cancel") {
        await cancelArchiveRequest(submission.id);
    }

    else if (action === "archive-vote-reject") {
        await voteArchiveRequest(
            submission.id,
            "rejected",
        );
    }
    if (action === "archive-merge") {
        await persistArchiveMerge(submission, {
            email: reviewerEmail,
            content: normalizedMessage,
            action: actionDescription(action, reviewerEmail),
        });
    }

    // Accept/reject (and cancel/reject-vote returning to accepted) use the
    // durable status route. Archive-request and archived stay Archive-owned.
    if (DURABLE_STATUS_WRITES.has(nextStatus) && action !== "archive-merge") {
        await setWorkspaceSubmissionStatus(submission, nextStatus);
    }
    await addWorkspaceComment(submission.id, {
        content: normalizedMessage,
        action: actionDescription(action, reviewerEmail),
        is_closing: true,
    });
    const [review, submissionStatus] = await Promise.all([
        getWorkspaceReviewState(submission.id),
        action === "archive-request"
            ? getWorkspaceSubmissionStatus(submission.id)
            : Promise.resolve(null),
    ]);
    return { status: nextStatus, review, submissionStatus };
}

export function canMergeArchiveRequest(request) {
    if (!request?.assignees?.length) return false;
    return request.assignees.every((email) => request.votes?.[email] === "accepted");
}

/**
 * Transitional Commissioner heatmap aggregate over hybrid Workspace data.
 * Replace with a compact authenticated server aggregate for production scale.
 */
export async function getSubmissionHeatmap() {
    const submissions = await getWorkspaceSubmissions({ includeArchived: false });
    const countsByDguid = {};

    submissions
        .filter((submission) => [WORKSPACE_STATUS.PENDING, WORKSPACE_STATUS.ARCHIVE_REQUEST].includes(submission.status))
        .forEach((submission) => {
            [submission.dguid, submission.neighboring_dguid].filter(Boolean).forEach((dguid) => {
                countsByDguid[dguid] = (countsByDguid[dguid] ?? 0) + 1;
            });
        });

    return { countsByDguid };
}

/** Dashboard-only DA-card query; the server filters DGUID and scope in SQL. */
export async function getDashboardAreaContext(dguid, { signal } = {}) {
    const target = String(dguid ?? "");
    if (!target) {
        return {
            selectedArea: null,
            relationship: "out_of_scope",
            inScopeNeighbors: [],
            submissions: { comments: [], objections: [], counterProposals: [] },
        };
    }
    const response = await fetch(`/api/workspace/dashboard/areas/${encodeURIComponent(target)}`, {
        credentials: "include",
        signal,
    });
    const payload = await handleResponse(response);
    const active = Array.isArray(payload?.submissions)
        ? payload.submissions.map((submission) => ({
            ...submission,
            authorEmail: submission.author?.email ?? "Unknown submitter",
            status: normalizeWorkspaceStatus(submission.status),
        }))
        : [];

    return {
        selectedArea: payload?.selectedArea ?? null,
        relationship: payload?.selectedArea?.relationship ?? payload?.relationship ?? "out_of_scope",
        inScopeNeighbors: Array.isArray(payload?.inScopeNeighbors) ? payload.inScopeNeighbors : [],
        submissions: {
            comments: active.filter((submission) => ["feedback", "comment"].includes(normalizeType(submission.type))),
            objections: active.filter((submission) => normalizeType(submission.type) === "objection"),
            counterProposals: active.filter((submission) => normalizeType(submission.type) === "counter-proposal"),
        },
    };
}

/** @deprecated Use getDashboardAreaContext for scope-aware dashboard cards. */
export async function getDashboardSubmissionsForDguid(dguid, { signal } = {}) {
    const context = await getDashboardAreaContext(dguid, { signal });
    return context.submissions;
}

async function getRemoteArchiveTreeRecords() {
    const response = await fetch("/api/workspace/archive-tree", { credentials: "include" });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to load the Archived Tree from Supabase.");
    }
    const payload = await response.json();
    const records = Array.isArray(payload?.records) ? payload.records : [];
    return records.map((record) => ({
        submission: {
            ...(record.submission ?? {}),
            status: WORKSPACE_STATUS.ARCHIVED,
        },
        branchKey: record.branchKey ?? null,
        versionNumber: Number(record.versionNumber) || null,
        isLatest: Boolean(record.isLatest),
        revertedAt: record.revertedAt ?? null,
        revertedBy: record.revertedBy ?? null,
        mergedBy: record.mergedBy ?? "Unknown commissioner",
        mergedAt: record.mergedAt,
        closingComment: record.closingComment ?? null,
        versionId: record.versionId ?? null,
        branchId: record.branchId ?? null,
        submissionType: record.submissionType ?? null,
        primaryDguid: record.primaryDguid ?? record.submission?.dguid ?? null,
        secondaryDguid: record.secondaryDguid ?? record.submission?.neighboring_dguid ?? null,
        releaseId: record.releaseId ?? null,
        resourceVersion: record.resourceVersion ?? 1,
        geometryDigest: record.geometryDigest ?? null,
        hasGeometry: Boolean(record.hasGeometry),
        validationReport: record.validationReport ?? null,
    }));
}

/** Latest archived map overlay from archive_map_da_heads when available. */
export async function getArchivedMapSnapshot(dguids = [], {
    expectedRevision,
    signal,
    includeAllHeads = false,
} = {}) {
    const params = new URLSearchParams();
    if (Array.isArray(dguids) && dguids.length) {
        params.set("dguids", dguids.join(","));
    }
    if (includeAllHeads) {
        params.set("includeAllHeads", "1");
    }
    if (expectedRevision !== undefined && expectedRevision !== null && expectedRevision !== "") {
        params.set("expectedRevision", String(expectedRevision));
    }
    const query = params.toString();
    const response = await fetch(`/api/workspace/archive-map${query ? `?${query}` : ""}`, {
        credentials: "include",
        signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.error || "Unable to load the archived map.");
        error.code = payload.code ?? null;
        throw error;
    }
    return payload;
}

export async function getArchiveBranchView(versionId, {
    branchKey = null,
    includeDifference = true,
    signal,
} = {}) {
    const params = new URLSearchParams();
    if (branchKey) params.set("branchKey", branchKey);
    if (!includeDifference) params.set("includeDifference", "0");
    const query = params.toString();
    const response = await fetch(
        `/api/workspace/archive-tree/versions/${encodeURIComponent(versionId)}/view${query ? `?${query}` : ""}`,
        { credentials: "include", signal },
    );
    return handleResponse(response);
}

/** Durable Archived Tree read. This path intentionally does not use localStorage. */
export async function getArchiveTreeRecords() {
    const remoteRecords = await getRemoteArchiveTreeRecords();
    return remoteRecords
        .sort((left, right) => new Date(right.mergedAt) - new Date(left.mergedAt));
}

export async function getArchiveVersionGeometry(versionId, { signal } = {}) {
    const response = await fetch(
        `/api/workspace/archive-tree/versions/${encodeURIComponent(versionId)}/geometry?representation=display`,
        { credentials: "include", signal },
    );
    return handleResponse(response);
}

async function mutateArchiveTree(path, method, body) {
    const response = await fetch(path, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.error || "Archived Tree update failed.");
        error.code = payload.code ?? null;
        error.status = response.status;
        throw error;
    }
    return payload;
}

/** Durable, destructive Archive Tree mutation via the commissioner-only API. */
export function deleteArchiveBranch(branchKey, { branchId, expectedBranchVersion } = {}) {
    if (branchId && expectedBranchVersion) {
        return mutateArchiveTree(
            `/api/workspace/archive/branches/${encodeURIComponent(branchId)}`,
            "DELETE",
            { expectedBranchVersion },
        );
    }
    const error = new Error(`Archive branch ${branchKey} has not been migrated to archive v2.`);
    error.code = "ARCHIVE_V2_MIGRATION_REQUIRED";
    return Promise.reject(error);
}

/** Durable Archive Tree latest-version mutation via the commissioner-only API. */
export function revertArchiveBranch(branchKey, submissionId, {
    versionId,
    expectedBranchVersion,
    expectedMapRevision,
} = {}) {
    if (versionId && expectedBranchVersion) {
        return mutateArchiveTree(
            `/api/workspace/archive/versions/${encodeURIComponent(versionId)}/revert`,
            "POST",
            { expectedBranchVersion, expectedMapRevision },
        );
    }
    const error = new Error(`Archive version ${submissionId} has not been migrated to archive v2.`);
    error.code = "ARCHIVE_V2_MIGRATION_REQUIRED";
    return Promise.reject(error);
}

export async function getArchivedMapProjections(dguid, { signal } = {}) {
    const params = new URLSearchParams({ dguid: String(dguid ?? "") });
    const response = await fetch(`/api/workspace/archive-map/projections?${params}`, {
        credentials: "include",
        signal,
    });
    const payload = await handleResponse(response);
    return payload;
}

function normalizeType(value) {
    return String(value ?? "feedback").trim().toLowerCase().replaceAll("_", "-");
}
