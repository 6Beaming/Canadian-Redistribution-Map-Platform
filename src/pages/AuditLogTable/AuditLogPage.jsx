import { useNavigate } from "react-router-dom";

import columns from "./AuditLogColumns"
import AuditLogTable from "./AuditLogTable"


//AI generated test data from chatgpt
const auditLogs = [
    {
        id: "log_001",
        date: "2026-07-06T09:15:00Z",
        user_id: "user_123",
        action: "new comment",
        target_id: "comment_001",
        details: "Created comment on proposal_42"
    },
    {
        id: "log_002",
        date: "2026-07-06T09:22:00Z",
        user_id: "user_456",
        action: "edit comment",
        target_id: "comment_001",
        details: "Updated comment text"
    },
    {
        id: "log_003",
        date: "2026-07-06T09:30:00Z",
        user_id: "user_789",
        action: "delete comment",
        target_id: "comment_015",
        details: "Deleted inappropriate comment"
    },
    {
        id: "log_004",
        date: "2026-07-06T10:05:00Z",
        user_id: "user_123",
        action: "new objection",
        target_id: "objection_001",
        details: "Created objection against proposal_42"
    },
    {
        id: "log_005",
        date: "2026-07-06T10:12:00Z",
        user_id: "user_234",
        action: "edit objection",
        target_id: "objection_001",
        details: "Added supporting rationale"
    },
    {
        id: "log_006",
        date: "2026-07-06T10:45:00Z",
        user_id: "user_345",
        action: "delete objection",
        target_id: "objection_003",
        details: "Removed duplicate objection"
    },
    {
        id: "log_007",
        date: "2026-07-06T11:00:00Z",
        user_id: "user_456",
        action: "new counterproposal",
        target_id: "counterproposal_001",
        details: "Created alternative proposal"
    },
    {
        id: "log_008",
        date: "2026-07-06T11:18:00Z",
        user_id: "user_567",
        action: "edit counterproposal",
        target_id: "counterproposal_001",
        details: "Updated budget estimates"
    },
    {
        id: "log_009",
        date: "2026-07-06T11:40:00Z",
        user_id: "user_678",
        action: "delete counterproposal",
        target_id: "counterproposal_004",
        details: "Withdrawn by author"
    },
    {
        id: "log_010",
        date: "2026-07-06T12:00:00Z",
        user_id: "user_123",
        action: "tag",
        target_id: "proposal_042",
        details: "Added tag: Infrastructure"
    },
    {
        id: "log_011",
        date: "2026-07-06T12:15:00Z",
        user_id: "user_890",
        action: "new comment",
        target_id: "comment_021",
        details: "Commented on proposal_051"
    },
    {
        id: "log_012",
        date: "2026-07-06T12:28:00Z",
        user_id: "user_234",
        action: "edit comment",
        target_id: "comment_021",
        details: "Fixed spelling mistakes"
    },
    {
        id: "log_013",
        date: "2026-07-06T12:41:00Z",
        user_id: "user_345",
        action: "new objection",
        target_id: "objection_010",
        details: "Objected due to environmental concerns"
    },
    {
        id: "log_014",
        date: "2026-07-06T13:00:00Z",
        user_id: "user_678",
        action: "edit objection",
        target_id: "objection_010",
        details: "Added supporting evidence"
    },
    {
        id: "log_015",
        date: "2026-07-06T13:16:00Z",
        user_id: "user_789",
        action: "new counterproposal",
        target_id: "counterproposal_011",
        details: "Suggested revised project timeline"
    },
    {
        id: "log_016",
        date: "2026-07-06T13:31:00Z",
        user_id: "user_567",
        action: "edit counterproposal",
        target_id: "counterproposal_011",
        details: "Updated implementation phases"
    },
    {
        id: "log_017",
        date: "2026-07-06T13:47:00Z",
        user_id: "user_890",
        action: "tag",
        target_id: "proposal_051",
        details: "Added tag: Sustainability"
    },
    {
        id: "log_018",
        date: "2026-07-06T14:05:00Z",
        user_id: "user_123",
        action: "new comment",
        target_id: "comment_022",
        details: "Requested clarification"
    },
    {
        id: "log_019",
        date: "2026-07-06T14:20:00Z",
        user_id: "user_456",
        action: "delete comment",
        target_id: "comment_018",
        details: "Removed duplicate comment"
    },
    {
        id: "log_020",
        date: "2026-07-06T14:39:00Z",
        user_id: "user_901",
        action: "new objection",
        target_id: "objection_011",
        details: "Raised budget concerns"
    },
    {
        id: "log_021",
        date: "2026-07-06T14:58:00Z",
        user_id: "user_234",
        action: "delete objection",
        target_id: "objection_007",
        details: "Withdrawn by author"
    },
    {
        id: "log_022",
        date: "2026-07-06T15:12:00Z",
        user_id: "user_345",
        action: "tag",
        target_id: "proposal_060",
        details: "Added tag: Budget"
    },
    {
        id: "log_023",
        date: "2026-07-06T15:26:00Z",
        user_id: "user_567",
        action: "new counterproposal",
        target_id: "counterproposal_012",
        details: "Suggested alternative funding model"
    },
    {
        id: "log_024",
        date: "2026-07-06T15:40:00Z",
        user_id: "user_678",
        action: "edit counterproposal",
        target_id: "counterproposal_012",
        details: "Adjusted cost projections"
    },
    {
        id: "log_025",
        date: "2026-07-06T15:54:00Z",
        user_id: "user_789",
        action: "new comment",
        target_id: "comment_023",
        details: "Supported the proposed changes"
    },
    {
        id: "log_026",
        date: "2026-07-06T16:08:00Z",
        user_id: "user_890",
        action: "edit comment",
        target_id: "comment_023",
        details: "Added additional references"
    },
    {
        id: "log_027",
        date: "2026-07-06T16:24:00Z",
        user_id: "user_901",
        action: "tag",
        target_id: "proposal_061",
        details: "Added tag: Community"
    },
    {
        id: "log_028",
        date: "2026-07-06T16:39:00Z",
        user_id: "user_123",
        action: "delete counterproposal",
        target_id: "counterproposal_008",
        details: "Removed obsolete proposal"
    },
    {
        id: "log_029",
        date: "2026-07-06T16:53:00Z",
        user_id: "user_456",
        action: "new objection",
        target_id: "objection_012",
        details: "Questioned legal compliance"
    },
    {
        id: "log_030",
        date: "2026-07-06T17:10:00Z",
        user_id: "user_567",
        action: "tag",
        target_id: "proposal_062",
        details: "Added tag: Transportation"
    },
];



export default function AuditLogPage() {
    const navigate = useNavigate();
    return (
        <div className="px-4 py-6 md:px-6">
            <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <div>
                <AuditLogTable
                    columns={columns}
                    data={auditLogs}
                    onRowClick={() => navigate("/dashboard/workspace")}
                />
            </div>
            </div>
        </div>
    )
}
