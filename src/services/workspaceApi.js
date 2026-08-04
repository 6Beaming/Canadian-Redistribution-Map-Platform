import {
    hydrateWorkspaceSubmission,
} from "@/services/tempCounterProposal.js";
import {
    getCommissionerSubmissionTableRows,
    getSubmissionTableRowById,
} from "@/services/submissionListsApi.js";
import {
    patchWorkspaceSubmissionStatus,
} from "@/services/workspaceStatusApi.js";
import * as archiveRequestApi from "@/services/archiveRequestApi.js";

const REALTIME_INVALIDATION_EVENT = "crmp:realtime-invalidation";
const DURABLE_STATUS_WRITES = new Set(["accepted", "rejected"]);


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
export async function getWorkspaceSubmissions({ includeArchived = true } = {}) {
    const { items } = await getCommissionerSubmissionTableRows();
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
        // Archive Request is CP4-owned. CP5 collaboration remains usable when
        // that optional service is not mounted or is temporarily unavailable.
        getArchiveRequest(submissionId).catch(() => null),
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

export function subscribeWorkspaceState(listener) {
    if (typeof window === "undefined") return () => { };
    const handleFocus = () => listener();
    const handleVisibility = () => {
        if (document.visibilityState === "visible") listener();
    };
    const handleInvalidation = (event) => {
        const resource = event?.detail?.resource;
        if (!resource || String(resource).startsWith("workspace")) listener();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener(REALTIME_INVALIDATION_EVENT, handleInvalidation);
    return () => {
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleVisibility);
        window.removeEventListener(REALTIME_INVALIDATION_EVENT, handleInvalidation);
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

export async function updateWorkspaceArchiveAssignees(submissionId, assignees) {
    const current = await archiveRequestApi.getArchiveRequest(submissionId);
    if (!current?.id) {
        throw new Error("Archive request not found.");
    }
    return archiveRequestApi.updateArchiveRequestAssignees(current.id, assignees, {
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
    if (action === "reject") nextStatus = WORKSPACE_STATUS.REJECTED;
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
        if (submission) {
            submission.status = WORKSPACE_STATUS.ARCHIVE_REQUEST;
            submission.resource_version = Number(submission.resource_version || 1) + 1;
        }
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
    return { status: nextStatus, review: await getWorkspaceReviewState(submission.id) };
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

/** Hybrid DA-card query used by the Dashboard InfoPanel. */
export async function getDashboardSubmissionsForDguid(dguid) {
    const target = String(dguid ?? "");
    if (!target) return { comments: [], objections: [], counterProposals: [] };
    const submissions = await getWorkspaceSubmissions({ includeArchived: false });
    const active = submissions.filter((submission) =>
        [WORKSPACE_STATUS.PENDING, WORKSPACE_STATUS.ARCHIVE_REQUEST].includes(submission.status) &&
        [submission.dguid, submission.neighboring_dguid].some((value) => String(value ?? "") === target),
    );

    return {
        comments: active.filter((submission) => ["feedback", "comment"].includes(normalizeType(submission.type))),
        objections: active.filter((submission) => normalizeType(submission.type) === "objection"),
        counterProposals: active.filter((submission) => normalizeType(submission.type) === "counter-proposal"),
    };
}

async function getRemoteArchiveTreeRecords() {
    const response = await fetch("/api/workspace/archive", { credentials: "include" });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to load the Archived Tree from Supabase.");
    }
    const records = await response.json();
    return Array.isArray(records) ? records.map((record) => ({
        submission: {
            ...(record.submission_snapshot ?? {}),
            status: WORKSPACE_STATUS.ARCHIVED,
        },
        branchKey: record.branch_key ?? null,
        versionNumber: Number(record.version_number) || null,
        isLatest: Boolean(record.is_latest),
        revertedAt: record.reverted_at ?? null,
        revertedBy: record.reverted_by_email ?? record.reverted_by ?? null,
        mergedBy: record.merged_by_email ?? record.merged_by ?? "Unknown commissioner",
        mergedAt: record.merged_at,
        closingComment: record.closing_comment ?? null,
    })) : [];
}

/** Durable Archived Tree read. This path intentionally does not use localStorage. */
export async function getArchiveTreeRecords() {
    const remoteRecords = await getRemoteArchiveTreeRecords();
    return remoteRecords
        .sort((left, right) => new Date(right.mergedAt) - new Date(left.mergedAt));
}

async function mutateArchiveTree(path, method, body) {
    const response = await fetch(path, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Archived Tree update failed.");
    return payload;
}

/** Durable, destructive Archive Tree mutation via the commissioner-only API. */
export function deleteArchiveBranch(branchKey) {
    return mutateArchiveTree("/api/workspace/archive/branch", "DELETE", { branchKey });
}

/** Durable Archive Tree latest-version mutation via the commissioner-only API. */
export function revertArchiveBranch(branchKey, submissionId) {
    return mutateArchiveTree("/api/workspace/archive/branch/latest", "PATCH", {
        branchKey,
        submissionId,
    });
}

function normalizeType(value) {
    return String(value ?? "feedback").trim().toLowerCase().replaceAll("_", "-");
}
