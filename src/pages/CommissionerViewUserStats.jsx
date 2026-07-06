import UserViewStatistics from "@/pages/UserViewStatistics.jsx";

const COMMISSIONER_STATS_NOTE =
  "This should be refactored to an aggregation statistical map of user submissions!";

export default function CommissionerViewUserStats({ selection, profilesByDguid }) {
  return (
    <div className="map-info-panel__view">
      <UserViewStatistics
        selection={selection}
        profilesByDguid={profilesByDguid}
      />
      <p className="feature-placeholder__note feature-placeholder__note--inline">
        {COMMISSIONER_STATS_NOTE}
      </p>
    </div>
  );
}
