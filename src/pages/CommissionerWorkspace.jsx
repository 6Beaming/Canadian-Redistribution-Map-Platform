import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Filter,
  Flag,
  GitCompareArrows,
  MessageSquareText,
  Network,
  X,
} from "lucide-react";
import {
  getWorkspaceSubmission,
  mapWorkspaceSubmissions,
} from "@/services/workspaceApi.js";
import { getCommissionerSubmissionListStore } from "@/lib/submissions/commissionerSubmissionListStore.js";
import { useRouteLoading } from "@/contexts/RouteLoadingContext.jsx";
import { PanelLoadingOverlay } from "@/components/non_prebuilt/LoadingIndicator.jsx";
import "@/styles/workspace.css";

const VISIBLE_LIST_ITEMS = 3;

const CATEGORY_DEFINITIONS = [
  {
    id: "comments",
    title: "Comments towards a DA",
    description: "Public comments on dissemination areas",
    icon: MessageSquareText,
    matches: (submission) => normalizeType(submission.type) === "feedback",
  },
  {
    id: "objections",
    title: "Objections towards a Boundary",
    description: "Objections submitted regarding proposed boundaries",
    icon: Flag,
    matches: (submission) => normalizeType(submission.type) === "objection",
  },
  {
    id: "counter-proposals",
    title: "Counter-Proposal towards a Boundary",
    description: "Alternative boundary proposals from the public",
    icon: GitCompareArrows,
    matches: (submission) => normalizeType(submission.type) === "counter-proposal",
  },
];

const LIST_DEFINITIONS = {
  pendingSubmissions: {
    status: "pending-submissions",
    title: "Pending Submissions",
    icon: Clock3,
    emptyLabel: "No pending submissions",
  },
  archiveRequest: {
    status: "archive-request",
    title: "Archive Request",
    icon: ArchiveRestore,
    emptyLabel: "No archive requests",
  },
  accepted: {
    status: "accepted",
    title: "Accepted",
    icon: CheckCircle2,
    emptyLabel: "No accepted submissions",
  },
  rejected: {
    status: "rejected",
    title: "Rejected",
    icon: X,
    emptyLabel: "No rejected submissions",
  },
};

function createCategoryExpansion(isOpen = true) {
  return {
    open: isOpen,
    pending: isOpen,
    finished: isOpen,
    pendingSubmissions: isOpen,
    archiveRequest: isOpen,
    accepted: isOpen,
    rejected: isOpen,
  };
}

function createExpansionState(isOpen = true) {
  return {
    root: isOpen,
    categories: Object.fromEntries(
      CATEGORY_DEFINITIONS.map(({ id }) => [id, createCategoryExpansion(isOpen)]),
    ),
  };
}

function getCategoryIdForSubmission(submission) {
  const type = normalizeType(submission?.type);
  if (type === "objection") return "objections";
  if (type === "counter-proposal") return "counter-proposals";
  return "comments";
}

function getBranchForSubmission(submission) {
  const status = normalizeStatus(submission?.status);
  if (status === "archive-request") return "archiveRequest";
  if (status === "accepted") return "accepted";
  if (status === "rejected") return "rejected";
  return "pendingSubmissions";
}

function createFocusedExpansion(submission) {
  const state = createExpansionState(false);
  const categoryId = getCategoryIdForSubmission(submission);
  const branch = getBranchForSubmission(submission);
  const isPending = ["pendingSubmissions", "archiveRequest"].includes(branch);

  state.root = true;
  state.categories[categoryId] = {
    ...state.categories[categoryId],
    open: true,
    pending: isPending,
    finished: !isPending,
    [branch]: true,
  };
  return state;
}

function cloneExpansionState(state) {
  return {
    root: state.root,
    categories: Object.fromEntries(
      Object.entries(state.categories).map(([id, category]) => [id, { ...category }]),
    ),
  };
}

function normalizeType(value) {
  const type = String(value ?? "feedback").trim().toLowerCase().replaceAll("_", "-");
  return type === "comment" ? "feedback" : type;
}

function normalizeStatus(value) {
  const status = String(value ?? "pending").trim().toLowerCase().replaceAll("_", "-");

  if (["accepted", "approved", "addressed"].includes(status)) return "accepted";
  if (status === "rejected") return "rejected";
  if (["archive-request", "archive-requested", "archive request"].includes(status)) {
    return "archive-request";
  }
  if (["archived", "archive", "achived"].includes(status)) return "archived";
  return "pending";
}

function shortReferenceId(value) {
  const referenceId = String(value ?? "").trim();
  return referenceId ? `${referenceId.slice(0, 5)}...` : "—";
}

function formatSubmissionDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
  });
}

function getSubmissionIcon(type) {
  const normalizedType = normalizeType(type);

  if (normalizedType === "counter-proposal") return GitCompareArrows;
  if (normalizedType === "objection") return Flag;
  return MessageSquareText;
}

function Collapsible({ isOpen, className = "", children }) {
  return (
    <div
      className={`workspace-collapse${isOpen ? " is-open" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden={!isOpen}
    >
      <div className="workspace-collapse__inner">{children}</div>
    </div>
  );
}

function NodeToggle({ isOpen }) {
  return (
    <ChevronDown
      className={`workspace-node-toggle${isOpen ? " is-open" : ""}`}
      aria-hidden="true"
    />
  );
}

function StatusKey() {
  const items = [
    ["pendingSubmissions", "Pending Submissions"],
    ["archiveRequest", "Archive Request"],
    ["accepted", "Accepted"],
    ["rejected", "Rejected"],
  ];

  return (
    <aside className="workspace-status-key" aria-label="Status key">
      <p className="workspace-status-key__title">Status Key</p>
      <div className="workspace-status-key__items">
        {items.map(([branch, label]) => {
          const Icon = LIST_DEFINITIONS[branch].icon;

          return (
            <span className={`workspace-status-key__item workspace-status-key__item--${branch}`} key={branch}>
              <Icon aria-hidden="true" />
              {label}
            </span>
          );
        })}
      </div>
    </aside>
  );
}

function RootCard({ total, isOpen, onToggle }) {
  return (
    <button
      type="button"
      className="workspace-root-card"
      aria-expanded={isOpen}
      onClick={onToggle}
    >
      <span className="workspace-node-icon workspace-node-icon--root">
        <Network aria-hidden="true" />
      </span>
      <span className="workspace-root-card__copy">
        <strong>Workspace</strong>
        <small>All submission categories</small>
      </span>
      <span className="workspace-root-card__total">
        <small>Total</small>
        <strong>{total}</strong>
      </span>
      <NodeToggle isOpen={isOpen} />
    </button>
  );
}

function StatusPill({ status, count, isOpen, onToggle }) {
  const isPending = status === "pending";
  const Icon = isPending ? Clock3 : Check;

  return (
    <button
      type="button"
      className={`workspace-status-pill workspace-status-pill--${status}`}
      aria-expanded={isOpen}
      onClick={onToggle}
    >
      <span className="workspace-status-pill__icon"><Icon aria-hidden="true" /></span>
      <strong>{isPending ? "Pending" : "Finished"}</strong>
      <span className="workspace-status-pill__count">{count}</span>
      <NodeToggle isOpen={isOpen} />
    </button>
  );
}

function SubmissionList({ branch, submissions, isOpen, onToggle, focusId, onSubmissionOpen }) {
  const location = useLocation();
  const definition = LIST_DEFINITIONS[branch];
  const HeaderIcon = definition.icon;
  const [showAll, setShowAll] = useState(false);
  const focusedSubmission = focusId
    ? submissions.find((submission) => String(submission.id) === String(focusId))
    : null;
  // A table-driven focus should bring the selected record to the top, not
  // replace its branch. Keep the remaining records available through Show more.
  const displayedSubmissions = focusedSubmission
    ? [
      focusedSubmission,
      ...submissions.filter((submission) => String(submission.id) !== String(focusedSubmission.id)),
    ]
    : submissions;
  const visibleSubmissions = showAll
    ? displayedSubmissions
    : displayedSubmissions.slice(0, VISIBLE_LIST_ITEMS);
  const remainingCount = Math.max(0, displayedSubmissions.length - visibleSubmissions.length);

  useEffect(() => setShowAll(false), [focusId, submissions]);

  return (
    <section className={`workspace-resolution-card workspace-resolution-card--${definition.status}`}>
      <button
        type="button"
        className="workspace-resolution-card__header"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <span className="workspace-resolution-card__icon"><HeaderIcon aria-hidden="true" /></span>
        <strong>{definition.title}</strong>
        <span className="workspace-resolution-card__count">{submissions.length}</span>
        <NodeToggle isOpen={isOpen} />
      </button>

      <Collapsible isOpen={isOpen} className="workspace-resolution-card__collapse">
        <div className="workspace-resolution-card__rows">
          {visibleSubmissions.length ? visibleSubmissions.map((submission) => {
            const SubmissionIcon = getSubmissionIcon(submission.type);

            return (
              <button
                type="button"
                className={`workspace-submission-row${String(submission.id) === String(focusId) ? " workspace-submission-row--arrival" : ""}`}
                key={String(submission.id) === String(focusId) ? `${submission.id}:${location.key}` : submission.id}
                onClick={() => onSubmissionOpen(submission.id)}
              >
                <span className="workspace-submission-row__glyph" aria-hidden="true">
                  <SubmissionIcon />
                </span>
                <span className="workspace-submission-row__id" title={submission.id}>
                  {shortReferenceId(submission.id)}
                </span>
                <time dateTime={submission.created_at}>{formatSubmissionDate(submission.created_at)}</time>
              </button>
            );
          }) : (
            <p className="workspace-resolution-card__empty">{definition.emptyLabel}</p>
          )}
        </div>

        {remainingCount > 0 || (showAll && displayedSubmissions.length > VISIBLE_LIST_ITEMS) ? (
          <button
            type="button"
            className="workspace-resolution-card__more"
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll ? "Show fewer" : `+ ${remainingCount} more`}
          </button>
        ) : null}
      </Collapsible>
    </section>
  );
}

function CategoryTrack({
  definition,
  submissions,
  expansion,
  onToggle,
  focusId,
  onSubmissionOpen,
}) {
  const CategoryIcon = definition.icon;
  const pending = submissions.filter((submission) => submission.status === "pending");
  const archiveRequests = submissions.filter((submission) => submission.status === "archive-request");
  const accepted = submissions.filter((submission) => submission.status === "accepted");
  const rejected = submissions.filter((submission) => submission.status === "rejected");
  const pendingCount = pending.length + archiveRequests.length;
  const finishedCount = accepted.length + rejected.length;

  return (
    <article className="workspace-category-track">
      <button
        type="button"
        className="workspace-category-card"
        aria-expanded={expansion.open}
        onClick={() => onToggle("open")}
      >
        <span className="workspace-node-icon"><CategoryIcon aria-hidden="true" /></span>
        <span className="workspace-category-card__copy">
          <strong>{definition.title}</strong>
          <small>{definition.description}</small>
        </span>
        <strong className="workspace-category-card__count">{submissions.length}</strong>
        <NodeToggle isOpen={expansion.open} />
      </button>

      <Collapsible isOpen={expansion.open} className="workspace-category-children">
        <div className="workspace-category-track__statuses">
          <StatusPill
            status="pending"
            count={pendingCount}
            isOpen={expansion.pending}
            onToggle={() => onToggle("pending")}
          />
          <StatusPill
            status="finished"
            count={finishedCount}
            isOpen={expansion.finished}
            onToggle={() => onToggle("finished")}
          />
        </div>

        <div className="workspace-category-track__branches">
          <Collapsible isOpen={expansion.pending} className="workspace-branch-collapse">
            <div className="workspace-branch-column workspace-branch-column--pending">
              <SubmissionList
                branch="pendingSubmissions"
                submissions={pending}
                isOpen={expansion.pendingSubmissions}
                onToggle={() => onToggle("pendingSubmissions")}
                focusId={focusId}
                onSubmissionOpen={onSubmissionOpen}
              />
              <SubmissionList
                branch="archiveRequest"
                submissions={archiveRequests}
                isOpen={expansion.archiveRequest}
                onToggle={() => onToggle("archiveRequest")}
                focusId={focusId}
                onSubmissionOpen={onSubmissionOpen}
              />
            </div>
          </Collapsible>

          <Collapsible isOpen={expansion.finished} className="workspace-branch-collapse">
            <div className="workspace-branch-column workspace-branch-column--finished">
              <SubmissionList
                branch="accepted"
                submissions={accepted}
                isOpen={expansion.accepted}
                onToggle={() => onToggle("accepted")}
                focusId={focusId}
                onSubmissionOpen={onSubmissionOpen}
              />
              <SubmissionList
                branch="rejected"
                submissions={rejected}
                isOpen={expansion.rejected}
                onToggle={() => onToggle("rejected")}
                focusId={focusId}
                onSubmissionOpen={onSubmissionOpen}
              />
            </div>
          </Collapsible>
        </div>
      </Collapsible>
    </article>
  );
}

function FilterCheckbox({ label, checked, depth = 0, onChange }) {
  return (
    <label className="workspace-filter-option" style={{ "--filter-depth": depth }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="workspace-filter-option__box"><Check aria-hidden="true" /></span>
      <span>{label}</span>
    </label>
  );
}

function FilterPanel({ state, onChange, onApply, onReset }) {
  function updateRoot(isChecked) {
    onChange(createExpansionState(isChecked));
  }

  function updateCategory(categoryId, isChecked) {
    onChange((current) => ({
      ...current,
      root: isChecked || Object.entries(current.categories).some(
        ([id, category]) => id !== categoryId && category.open,
      ),
      categories: {
        ...current.categories,
        [categoryId]: createCategoryExpansion(isChecked),
      },
    }));
  }

  function updateStatus(categoryId, status, isChecked) {
    onChange((current) => {
      const category = current.categories[categoryId];
      const branchKeys = status === "pending"
        ? ["pendingSubmissions", "archiveRequest"]
        : ["accepted", "rejected"];
      const nextCategory = {
        ...category,
        open: isChecked || category[status === "pending" ? "finished" : "pending"],
        [status]: isChecked,
      };

      branchKeys.forEach((key) => {
        nextCategory[key] = isChecked;
      });

      const nextCategories = { ...current.categories, [categoryId]: nextCategory };
      return {
        root: Object.values(nextCategories).some((entry) => entry.open),
        categories: nextCategories,
      };
    });
  }

  function updateLeaf(categoryId, branch, isChecked) {
    onChange((current) => {
      const category = current.categories[categoryId];
      const isPendingBranch = ["pendingSubmissions", "archiveRequest"].includes(branch);
      const sibling = isPendingBranch
        ? (branch === "pendingSubmissions" ? "archiveRequest" : "pendingSubmissions")
        : (branch === "accepted" ? "rejected" : "accepted");
      const parent = isPendingBranch ? "pending" : "finished";
      const nextCategory = {
        ...category,
        [branch]: isChecked,
        [parent]: isChecked || category[sibling],
      };
      nextCategory.open = nextCategory.pending || nextCategory.finished;
      const nextCategories = { ...current.categories, [categoryId]: nextCategory };

      return {
        root: Object.values(nextCategories).some((entry) => entry.open),
        categories: nextCategories,
      };
    });
  }

  return (
    <div className="workspace-filter-panel" role="dialog" aria-label="Workspace branch filter">
      <div className="workspace-filter-panel__heading">
        <strong>Expanded branches</strong>
        <small>Checked branches expand after applying.</small>
      </div>

      <div className="workspace-filter-panel__tree">
        <FilterCheckbox label="Workspace" checked={state.root} onChange={updateRoot} />

        {CATEGORY_DEFINITIONS.map((definition) => {
          const category = state.categories[definition.id];

          return (
            <div className="workspace-filter-panel__category" key={definition.id}>
              <FilterCheckbox
                label={definition.title}
                checked={category.open}
                depth={1}
                onChange={(checked) => updateCategory(definition.id, checked)}
              />
              <FilterCheckbox
                label="Pending"
                checked={category.pending}
                depth={2}
                onChange={(checked) => updateStatus(definition.id, "pending", checked)}
              />
              <FilterCheckbox
                label="Pending Submissions"
                checked={category.pendingSubmissions}
                depth={3}
                onChange={(checked) => updateLeaf(definition.id, "pendingSubmissions", checked)}
              />
              <FilterCheckbox
                label="Archive Request"
                checked={category.archiveRequest}
                depth={3}
                onChange={(checked) => updateLeaf(definition.id, "archiveRequest", checked)}
              />
              <FilterCheckbox
                label="Finished"
                checked={category.finished}
                depth={2}
                onChange={(checked) => updateStatus(definition.id, "finished", checked)}
              />
              <FilterCheckbox
                label="Accepted"
                checked={category.accepted}
                depth={3}
                onChange={(checked) => updateLeaf(definition.id, "accepted", checked)}
              />
              <FilterCheckbox
                label="Rejected"
                checked={category.rejected}
                depth={3}
                onChange={(checked) => updateLeaf(definition.id, "rejected", checked)}
              />
            </div>
          );
        })}
      </div>

      <div className="workspace-filter-panel__actions">
        <button type="button" className="workspace-filter-reset" onClick={onReset}>Reset</button>
        <button type="button" className="workspace-filter-apply" onClick={onApply}>Apply Filter</button>
      </div>
    </div>
  );
}

export default function CommissionerWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const { signalRouteReady } = useRouteLoading() ?? {};
  const signalRouteReadyRef = useRef(signalRouteReady);
  signalRouteReadyRef.current = signalRouteReady;
  const storeRef = useRef(getCommissionerSubmissionListStore());
  const focusedRowRef = useRef(null);
  const [workspaceSubmissions, setWorkspaceSubmissions] = useState([]);
  const [treeFetching, setTreeFetching] = useState(() => {
    const cached = mapWorkspaceSubmissions(storeRef.current.getItems(), { includeArchived: false });
    return cached.length === 0;
  });
  const [loadError, setLoadError] = useState("");
  const [expansion, setExpansion] = useState(() => createExpansionState(true));
  const [filterDraft, setFilterDraft] = useState(() => createExpansionState(true));
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();
    const store = storeRef.current;

    const mergeFocusedSubmission = (submissions, focused) => {
      const merged = new Map(
        (Array.isArray(submissions) ? submissions : []).map((submission) => [
          String(submission.id),
          submission,
        ]),
      );
      merged.set(String(focused.id), focused);
      return [...merged.values()].sort(
        (left, right) => new Date(right.created_at) - new Date(left.created_at),
      );
    };

    const syncFromStore = () => {
      if (!isMounted) return;
      const submissions = mapWorkspaceSubmissions(store.getItems(), { includeArchived: false });
      const focusedRow = focusedRowRef.current;
      const next = focusedRow
        ? mergeFocusedSubmission(submissions, focusedRow)
        : submissions;
      flushSync(() => {
        setWorkspaceSubmissions(next);
        if (next.length > 0 || !store.isBootstrapping()) {
          setTreeFetching(false);
          signalRouteReadyRef.current?.();
        }
      });
    };

    const unsubscribeStore = store.subscribe(syncFromStore);

    void (async () => {
      try {
        if (store.getItems().length === 0) {
          setTreeFetching(true);
        } else {
          syncFromStore();
        }

        // Hot start only — WorkspaceMapLayout owns submission-driven refresh.
        await store.ensureBootstrapped({ signal: abortController.signal });
        if (!isMounted) return;
        syncFromStore();
        setLoadError("");
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (isMounted) {
          setLoadError(error.message || "Submissions could not be loaded.");
          setTreeFetching(false);
        }
      }
    })();

    return () => {
      isMounted = false;
      abortController.abort();
      unsubscribeStore();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const store = storeRef.current;

    void (async () => {
      if (!focusId) {
        focusedRowRef.current = null;
        const submissions = mapWorkspaceSubmissions(store.getItems(), { includeArchived: false });
        if (isMounted) setWorkspaceSubmissions(submissions);
        return;
      }

      try {
        const focusedRow = await getWorkspaceSubmission(focusId, { hydrateGeometry: false });
        if (!isMounted) return;
        if (!focusedRow) throw new Error("The focused submission was not found.");
        focusedRowRef.current = focusedRow;
        setExpansion(createFocusedExpansion(focusedRow));
        const submissions = mapWorkspaceSubmissions(store.getItems(), { includeArchived: false });
        const merged = new Map(submissions.map((submission) => [String(submission.id), submission]));
        merged.set(String(focusedRow.id), focusedRow);
        setWorkspaceSubmissions(
          [...merged.values()].sort(
            (left, right) => new Date(right.created_at) - new Date(left.created_at),
          ),
        );
        setLoadError("");
      } catch (error) {
        if (isMounted) {
          setLoadError(error.message || "The focused submission was not found.");
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [focusId]);

  useEffect(() => {
    if (!focusId || !workspaceSubmissions.length) return;
    const focusedSubmission = workspaceSubmissions.find(
      (submission) => String(submission.id) === String(focusId),
    );
    if (focusedSubmission) setExpansion(createFocusedExpansion(focusedSubmission));
  }, [focusId, workspaceSubmissions]);
  useEffect(() => {
    if (!isFilterOpen) return undefined;

    function handlePointerDown(event) {
      if (!filterRef.current?.contains(event.target)) setIsFilterOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setIsFilterOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFilterOpen]);

  const categoryData = useMemo(() => {
    const normalizedSubmissions = workspaceSubmissions
      .map((submission) => ({
        ...submission,
        type: normalizeType(submission.type),
        status: normalizeStatus(submission.status),
      }))
      .filter((submission) => submission.status !== "archived");

    return CATEGORY_DEFINITIONS.map((definition) => ({
      definition,
      submissions: normalizedSubmissions.filter(definition.matches),
    }));
  }, [workspaceSubmissions]);

  const total = categoryData.reduce((sum, category) => sum + category.submissions.length, 0);

  function toggleCategoryBranch(categoryId, branch) {
    setExpansion((current) => ({
      ...current,
      categories: {
        ...current.categories,
        [categoryId]: {
          ...current.categories[categoryId],
          [branch]: !current.categories[categoryId][branch],
        },
      },
    }));
  }

  function openFilter() {
    setFilterDraft(cloneExpansionState(expansion));
    setIsFilterOpen((current) => !current);
  }

  function applyFilter() {
    setExpansion(cloneExpansionState(filterDraft));
    setIsFilterOpen(false);
    if (focusId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("focus");
      setSearchParams(nextParams, { replace: true });
    }
  }

  function resetFilter() {
    setFilterDraft(createExpansionState(true));
  }

  return (
    <main className="commissioner-workspace workspace-page" aria-labelledby="workspace-title">
      <div className="workspace-scroll-region">
        <div className="workspace-canvas">
          <header className="workspace-action-bar">
            <div className="workspace-heading">
              <span className="workspace-heading__icon"><Network aria-hidden="true" /></span>
              <div>
                <h1 id="workspace-title">Workspace</h1>
                <p>Review and decision workspace for user-submitted content</p>
              </div>
            </div>

            <div className="workspace-controls" aria-label="Workspace controls" ref={filterRef}>
              <button
                type="button"
                className="workspace-control-button"
                aria-expanded={isFilterOpen}
                onClick={openFilter}
              >
                <Filter aria-hidden="true" />
                Filter
                <ChevronDown className={isFilterOpen ? "is-open" : ""} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="workspace-control-button workspace-control-button--primary"
                onClick={() => navigate("/dashboard/archivedTree", {
                  state: { workspaceFrom: location.state?.from ?? null },
                })}
              >
                <Archive aria-hidden="true" />
                Archived Tree
              </button>

              {isFilterOpen ? (
                <FilterPanel
                  state={filterDraft}
                  onChange={setFilterDraft}
                  onApply={applyFilter}
                  onReset={resetFilter}
                />
              ) : null}
            </div>
          </header>

          {loadError ? (
            <p className="workspace-load-notice" role="alert">
              Live submissions are unavailable. Check your commissioner session and try again.
            </p>
          ) : null}
          <section className="workspace-tree relative" aria-busy={treeFetching} aria-label="Submission decision tree">
            {treeFetching ? <PanelLoadingOverlay label="Loading..." /> : null}
            <div className="workspace-tree__top-row">
              <RootCard
                total={treeFetching && workspaceSubmissions.length === 0 ? "—" : total}
                isOpen={expansion.root}
                onToggle={() => setExpansion((current) => ({ ...current, root: !current.root }))}
              />
              <StatusKey />
            </div>

            <Collapsible isOpen={expansion.root} className="workspace-root-children">
              <div className="workspace-tree__category-grid">
                {categoryData.map(({ definition, submissions }) => (
                  <CategoryTrack
                    key={definition.id}
                    definition={definition}
                    submissions={submissions}
                    expansion={expansion.categories[definition.id]}
                    onToggle={(branch) => toggleCategoryBranch(definition.id, branch)}
                    focusId={focusId}
                    onSubmissionOpen={(submissionId) =>
                      navigate(`/dashboard/workspace/${encodeURIComponent(submissionId)}`, {
                        state: {
                          from: "/dashboard/workspace",
                          focusId,
                          workspaceFrom: location.state?.from ?? null,
                        },
                      })
                    }
                  />
                ))}
              </div>
            </Collapsible>
          </section>
        </div>
      </div>
    </main>
  );
}
