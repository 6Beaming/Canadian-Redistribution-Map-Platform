import { getAllComments } from "@/services/commentsApi.js";
import {
    getTemporaryCounterProposalSubmissions,
    hydrateWorkspaceSubmission,
} from "@/services/tempCounterProposal.js";

const STORAGE_KEY = "crmp.workspace.v1";
const WORKSPACE_EVENT = "crmp:workspace-change";


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


export async function saveWorkspaceLabelsApi(submissionId, labels) {
    const res = await fetch(`/api/workspace/labels/${submissionId}`, {
        method: "POST",
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

export async function createArchiveRequest(submissionId, assignees) {
    const res = await fetch(`/api/workspace/archive-requests/${submissionId}`, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            assignees,
        }),
    });

    return handleResponse(res);
}


export async function getArchiveRequest(submissionId) {
    const res = await fetch(`/api/workspace/archive-requests/${submissionId}`, {
        method: "GET",
        credentials: "include",
    });

    return handleResponse(res);
}


export async function voteArchiveRequest(submissionId, vote) {
    const res = await fetch(`/api/workspace/archive-requests/${submissionId}/vote`, {
        method: "PATCH",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            vote,
        }),
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

function emptyWorkspaceState() {
    return {
        version: 1,
        submissions: {},
        comments: {},
        labels: {},
        labelCatalogs: {},
        archiveRequests: {},
    };
}

function canUseStorage() {
    return typeof window !== "undefined" && Boolean(window.localStorage);
}

function readWorkspaceState() {
    if (!canUseStorage()) return emptyWorkspaceState();

    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
        return parsed && parsed.version === 1
            ? { ...emptyWorkspaceState(), ...parsed }
            : emptyWorkspaceState();
    } catch {
        return emptyWorkspaceState();
    }
}

function writeWorkspaceState(nextState) {
    if (canUseStorage()) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT, { detail: nextState }));
    }

    return nextState;
}

function updateWorkspaceState(updater) {
    const current = readWorkspaceState();
    return writeWorkspaceState(updater(current));
}

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
    const localOverride = readWorkspaceState().submissions?.[submission.id] ?? {};

    return {
        ...submission,
        ...localOverride,
        source,
        status: normalizeWorkspaceStatus(localOverride.status ?? submission.status),
        authorEmail:
            submission.profile?.email ?? submission.authorEmail ?? localOverride.authorEmail ?? "Unknown",
        profile: submission.profile ?? (submission.authorEmail ? { email: submission.authorEmail } : null),
    };
}

/**
 * REUSED API: live comments and objections are read through the existing
 * authenticated GET /api/comments route. Counter-proposals are loaded from the
 * dedicated submissions API so revision geometry is available for review.
 */
async function loadLiveSubmissions() {
    try {
        const submissions = await getAllComments();
        return Array.isArray(submissions)
            ? submissions
                .filter((submission) => {
                    const type = String(submission?.type ?? "").toLowerCase().replaceAll("_", "-");
                    return type !== "counter-proposal";
                })
                .map((submission) => normalizeSubmission(submission, "supabase"))
            : [];
    } catch (error) {
        console.warn("Workspace live submissions are unavailable.", error);
        return [];
    }
}

/**
 * Persisted counter-proposals from GET /api/submissions/counter-proposals.
 * Geometry is intentionally not hydrated for list pages.
 */
async function loadPersistedCounterProposals() {
    return getTemporaryCounterProposalSubmissions().then((submissions) =>
        submissions.map((submission) => normalizeSubmission(submission, "supabase")),
    );
}

/**
 * Combines protected Supabase feedback/objections with persisted counter-proposals.
 */
export async function getWorkspaceSubmissions({ includeArchived = true } = {}) {
    const [liveSubmissions, counterProposals] = await Promise.all([
        loadLiveSubmissions(),
        loadPersistedCounterProposals(),
    ]);
    const submissions = [...liveSubmissions, ...counterProposals]
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
    const submissions = await getWorkspaceSubmissions({ includeArchived: true });
    const submission = submissions.find((entry) => String(entry.id) === String(submissionId));

    if (!submission || options.hydrateGeometry === false) return submission ?? null;
    return hydrateWorkspaceSubmission(submission, options.profilesByDguid);
}

/** Local-only review draft; not a shared or durable Workspace backend record. */
export async function getWorkspaceReviewState(submissionId) {
    const state = readWorkspaceState();

    const [
        comments,
        labels,
        archiveRequest,
    ] = await Promise.all([
        getWorkspaceComments(submissionId),
        getWorkspaceLabels(submissionId),
        getArchiveRequest(submissionId),
    ]);
    return {
        comments,
        labels,
        labelCatalog: [...(state.labelCatalogs?.[submissionId] ?? [])],
        archiveRequest,
    };
}

export function subscribeWorkspaceState(listener) {
    if (typeof window === "undefined") return () => { };
    const handleChange = () => listener(readWorkspaceState());
    window.addEventListener(WORKSPACE_EVENT, handleChange);
    window.addEventListener("storage", handleChange);
    return () => {
        window.removeEventListener(WORKSPACE_EVENT, handleChange);
        window.removeEventListener("storage", handleChange);
    };
}

/** Temporary localStorage label write. Replace with workspace_labels CRUD. */
export async function saveWorkspaceLabels(submissionId, labels) {
    const normalizedLabels = labels.map((label) => ({
        id: String(label.id),
        name: String(label.name).trim(),
        color: String(label.color),
        custom: Boolean(label.custom),
    }));

    return saveWorkspaceLabelsApi(submissionId, normalizedLabels);
}

/** Temporary localStorage label catalog write. Replace with shared label CRUD. */
export function saveWorkspaceLabelCatalog(submissionId, catalog) {
    const normalizedCatalog = catalog.map((label) => ({
        id: String(label.id),
        name: String(label.name ?? ""),
        color: String(label.color),
        custom: Boolean(label.custom),
    }));

    updateWorkspaceState((state) => ({
        ...state,
        labelCatalogs: { ...state.labelCatalogs, [submissionId]: normalizedCatalog },
    }));
    return normalizedCatalog;
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

/** Temporary localStorage archive-request write. Replace with durable votes and assignees. */
export function updateWorkspaceArchiveAssignees(submissionId, requesterEmail, assignees) {
    const normalizedAssignees = [...new Set(
        assignees.map((email) => String(email ?? "").trim()).filter(Boolean),
    )];
    let updatedRequest = null;

    updateWorkspaceState((state) => {
        const request = state.archiveRequests?.[submissionId];
        if (!request || request.requesterEmail !== requesterEmail) return state;

        const votes = Object.fromEntries(
            Object.entries(request.votes ?? {}).filter(([email]) =>
                normalizedAssignees.includes(email) || email === requesterEmail,
            ),
        );
        updatedRequest = { ...request, assignees: normalizedAssignees, votes };
        return {
            ...state,
            archiveRequests: {
                ...state.archiveRequests,
                [submissionId]: updatedRequest,
            },
        };
    });

    return updatedRequest;
}

async function persistLiveStatus(submission, status) {
    if (submission?.source !== "supabase") return;

    // HARD API: this temporary authenticated PATCH is implemented by
    // server/routes/workspace.js and should move into a durable domain service.
    const response = await fetch(`/api/workspace/submissions/${submission.id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to update submission status.");
    }
}

/**
 * Writes real Supabase submissions through the temporary Workspace route and
 * mirrors the result locally for the current UI. Fixture submissions remain local.
 */
export async function setWorkspaceSubmissionStatus(submission, status) {
    const normalizedStatus = normalizeWorkspaceStatus(status);
    await persistLiveStatus(submission, normalizedStatus);
    updateWorkspaceState((state) => ({
        ...state,
        submissions: {
            ...state.submissions,
            [submission.id]: {
                ...(state.submissions?.[submission.id] ?? {}),
                status: normalizedStatus,
                updated_at: new Date().toISOString(),
            },
        },
    }));
    return normalizedStatus;
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
    const currentReview = getWorkspaceReviewState(submission.id);
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
            [...new Set(assignees)]
        );
    } else if (action === "archive-vote-accept") {
        updateWorkspaceState((state) => {
            const request = state.archiveRequests?.[submission.id] ?? currentReview.archiveRequest;
            return {
                ...state,
                archiveRequests: {
                    ...state.archiveRequests,
                    [submission.id]: {
                        ...request,
                        votes: {
                            ...(request?.votes ?? {}),
                            [reviewerEmail]: "accepted",
                        },
                    },
                },
            };
        });
    } else if (["archive-cancel", "archive-vote-reject"].includes(action)) {
        updateWorkspaceState((state) => {
            const archiveRequests = { ...state.archiveRequests };
            delete archiveRequests[submission.id];
            return { ...state, archiveRequests };
        });
    }

    if (action === "archive-merge") {
        await persistArchiveMerge(submission, {
            email: reviewerEmail,
            content: normalizedMessage,
            action: actionDescription(action, reviewerEmail),
        });
    }

    if (action === "archive-merge") {
        updateWorkspaceState((state) => ({
            ...state,
            submissions: {
                ...state.submissions,
                [submission.id]: {
                    ...(state.submissions?.[submission.id] ?? {}),
                    status: WORKSPACE_STATUS.ARCHIVED,
                    updated_at: new Date().toISOString(),
                },
            },
        }));
    } else {
        await setWorkspaceSubmissionStatus(submission, nextStatus);
    }
    addWorkspaceComment(submission.id, {
        content: normalizedMessage,
        action: actionDescription(action, reviewerEmail),
        is_closing: true,
    });

    if (action === "archive-merge") {
        updateWorkspaceState((state) => {
            const comments = { ...state.comments };
            const labels = { ...state.labels };
            const archiveRequests = { ...state.archiveRequests };
            delete comments[submission.id];
            delete labels[submission.id];
            delete archiveRequests[submission.id];

            return {
                ...state,
                comments,
                labels,
                archiveRequests,
            };
        });
    }

    return { status: nextStatus, review: getWorkspaceReviewState(submission.id) };
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
