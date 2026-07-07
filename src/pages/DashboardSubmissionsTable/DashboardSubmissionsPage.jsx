import { useNavigate } from "react-router-dom";

import columns from "./SubmissionsColumns"
import SubmissionsTable from "./SubmissionsTable"


//AI generated test data from chatgpt
const submissions = [
  {
    id: "1",
    referenceNumber: "CRMP-2026-0001",
    type: "comment",
    riding: "Toronto Centre",
    submittedBy: "A. Patel",
    date: "2026-06-10",
    status: "under_review",
    sentiment: "oppose",
    summary: "Concerns about splitting downtown communities.",
    body: "The proposed boundary divides long-standing neighbourhoods and reduces community cohesion in the downtown core."
  },
  {
    id: "2",
    referenceNumber: "CRMP-2026-0002",
    type: "objection",
    riding: "York South—Weston",
    submittedBy: "Maria Gonzalez",
    date: "2026-06-11",
    status: "received",
    sentiment: "oppose",
    summary: "Objecting to boundary following highway instead of river.",
    body: "The boundary should follow the Humber River instead of Highway 401 to better reflect natural community divisions."
  },
  {
    id: "3",
    referenceNumber: "CRMP-2026-0003",
    type: "counterproposal",
    riding: "Vancouver East",
    submittedBy: "James Liu",
    date: "2026-06-12",
    status: "under_review",
    sentiment: "support",
    summary: "Alternative boundary improves population balance.",
    body: "Reassigning three census tracts to Vancouver Kingsway reduces deviation from quota to under 2%."
  },
  {
    id: "4",
    referenceNumber: "CRMP-2026-0004",
    type: "comment",
    riding: "Calgary Nose Hill",
    submittedBy: "Ethan Brown",
    date: "2026-06-12",
    status: "received",
    sentiment: "support",
    summary: "Supports proposed boundary alignment with growth zones.",
    body: "The new boundary reflects suburban expansion and maintains consistency with recent housing developments."
  },
  {
    id: "5",
    referenceNumber: "CRMP-2026-0005",
    type: "objection",
    riding: "Montreal Plateau",
    submittedBy: "Sophie Tremblay",
    date: "2026-06-13",
    status: "under_review",
    sentiment: "oppose",
    summary: "Concerns about splitting Francophone communities.",
    body: "The proposed boundary divides established Francophone neighbourhoods which share strong cultural ties."
  },
  {
    id: "6",
    referenceNumber: "CRMP-2026-0006",
    type: "comment",
    riding: "Ottawa West",
    submittedBy: "David Chen",
    date: "2026-06-13",
    status: "addressed",
    sentiment: "neutral",
    summary: "Neutral feedback regarding transit corridor alignment.",
    body: "Boundary alignment along transit corridors makes administrative sense but community impact is unclear."
  },
  {
    id: "7",
    referenceNumber: "CRMP-2026-0007",
    type: "counterproposal",
    riding: "Edmonton Strathcona",
    submittedBy: "Priya Singh",
    date: "2026-06-14",
    status: "received",
    sentiment: "support",
    summary: "Rebalancing proposal improves equity between ridings.",
    body: "Shifting the boundary eastward better aligns population distribution and keeps university communities intact."
  },
  {
    id: "8",
    referenceNumber: "CRMP-2026-0008",
    type: "comment",
    riding: "Halifax West",
    submittedBy: "Noah MacDonald",
    date: "2026-06-14",
    status: "under_review",
    sentiment: "oppose",
    summary: "Concern about splitting coastal communities.",
    body: "The boundary cuts through established coastal communities that share economic and cultural ties."
  },
  {
    id: "9",
    referenceNumber: "CRMP-2026-0009",
    type: "objection",
    riding: "Winnipeg Centre",
    submittedBy: "Lily Johnson",
    date: "2026-06-15",
    status: "received",
    sentiment: "oppose",
    summary: "Opposition to dividing downtown housing areas.",
    body: "Splitting the downtown core may dilute representation of housing and affordability issues."
  },
  {
    id: "10",
    referenceNumber: "CRMP-2026-0010",
    type: "comment",
    riding: "Surrey Central",
    submittedBy: "Arjun Mehta",
    date: "2026-06-15",
    status: "addressed",
    sentiment: "support",
    summary: "Supports boundary reflecting rapid population growth.",
    body: "The updated boundary appropriately reflects Surrey’s rapid population increase and urban expansion."
  },
  {
    id: "11",
    referenceNumber: "CRMP-2026-0011",
    type: "objection",
    riding: "Toronto Danforth",
    submittedBy: "Olivia Martin",
    date: "2026-06-16",
    status: "received",
    sentiment: "oppose",
    summary: "Concerns about splitting cultural corridors along Danforth Ave.",
    body: "The proposed boundary disrupts long-standing Greek and multicultural business corridors that define the community identity."
  },
  {
    id: "12",
    referenceNumber: "CRMP-2026-0012",
    type: "comment",
    riding: "Kitchener Centre",
    submittedBy: "Benjamin Wong",
    date: "2026-06-16",
    status: "under_review",
    sentiment: "neutral",
    summary: "Neutral stance on tech corridor alignment.",
    body: "While the boundary aligns well with the innovation district, more clarity is needed on residential impacts."
  },
  {
    id: "13",
    referenceNumber: "CRMP-2026-0013",
    type: "counterproposal",
    riding: "Mississauga East—Cooksville",
    submittedBy: "Hannah Kim",
    date: "2026-06-17",
    status: "under_review",
    sentiment: "support",
    summary: "Proposal improves balance between high-density zones.",
    body: "Adjusting the boundary to include adjacent high-rise developments reduces population imbalance and improves representation equity."
  },
  {
    id: "14",
    referenceNumber: "CRMP-2026-0014",
    type: "objection",
    riding: "Québec City Centre",
    submittedBy: "Marc Dubois",
    date: "2026-06-17",
    status: "received",
    sentiment: "oppose",
    summary: "Opposition to dividing historic Old Québec district.",
    body: "The proposed boundary separates heritage zones that share tourism, governance, and cultural preservation concerns."
  },
  {
    id: "15",
    referenceNumber: "CRMP-2026-0015",
    type: "comment",
    riding: "Regina Qu'Appelle",
    submittedBy: "Emily Carter",
    date: "2026-06-18",
    status: "addressed",
    sentiment: "support",
    summary: "Supports rural-urban balance improvements.",
    body: "The updated boundary better reflects the mix of agricultural and urban populations in the region."
  },
  {
    id: "16",
    referenceNumber: "CRMP-2026-0016",
    type: "counterproposal",
    riding: "London North Centre",
    submittedBy: "Jacob Thompson",
    date: "2026-06-18",
    status: "received",
    sentiment: "support",
    summary: "Improves student representation near Western University.",
    body: "Including adjacent student housing areas ensures better representation of transient and academic populations."
  },
  {
    id: "17",
    referenceNumber: "CRMP-2026-0017",
    type: "objection",
    riding: "Victoria South",
    submittedBy: "Sofia Nguyen",
    date: "2026-06-18",
    status: "under_review",
    sentiment: "oppose",
    summary: "Concerns about waterfront community division.",
    body: "The boundary splits key waterfront neighborhoods that share environmental and zoning concerns."
  },
  {
    id: "18",
    referenceNumber: "CRMP-2026-0018",
    type: "comment",
    riding: "St. John's East",
    submittedBy: "Liam O'Connor",
    date: "2026-06-18",
    status: "received",
    sentiment: "neutral",
    summary: "Neutral feedback on coastal boundary alignment.",
    body: "The proposed boundary follows natural coastal lines but may affect small fishing communities."
  },
  {
    id: "19",
    referenceNumber: "CRMP-2026-0019",
    type: "counterproposal",
    riding: "Burnaby North—Seymour",
    submittedBy: "Aisha Rahman",
    date: "2026-06-19",
    status: "under_review",
    sentiment: "support",
    summary: "Improves balance between mountain and urban populations.",
    body: "Reallocating boundary lines along major transit routes ensures more equitable population distribution."
  },
  {
    id: "20",
    referenceNumber: "CRMP-2026-0020",
    type: "comment",
    riding: "Hamilton Centre",
    submittedBy: "Daniel Rossi",
    date: "2026-06-19",
    status: "received",
    sentiment: "oppose",
    summary: "Concerns about industrial-residential boundary mixing.",
    body: "The boundary introduces overlap between heavy industrial zones and residential communities, raising safety concerns."
  }
]



export default function DashBoardSubmissionsPage() {
  const navigate = useNavigate();
  return (
    <div className="px-4 py-6 md:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div>
          <SubmissionsTable
            columns={columns}
            data={submissions}
            onRowClick={() => navigate("/dashboard/workspace")}
          />
        </div>
      </div>
    </div>
  )
}
